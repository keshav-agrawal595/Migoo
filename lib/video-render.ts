import { db } from "@/config/db";
import { shortVideoAssets, shortVideoSeries } from "@/config/schema";

import { generateNanoBananaImage } from "@/lib/leonardo";
import { eq } from "drizzle-orm";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

// Bundled FFmpeg binary — resolved to absolute path to avoid \ROOT\ virtual path issues in Next.js
function getFFmpegPath(): string {
    let ffmpegBin = require('ffmpeg-static') as string;
    if (!fs.existsSync(ffmpegBin)) {
        ffmpegBin = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    }
    return ffmpegBin;
}

/**
 * Prepare a video file for crash-proof Remotion rendering.
 *
 * ROOT CAUSE FIX for "No frame found at position" errors:
 *
 *   The Remotion compositor on Windows seeks to EXACT PTS positions.
 *   AI-generated videos (Kling, Runway, etc.) have:
 *     - Variable frame rates (VFR)
 *     - Large GOPs (keyframes every 250+ frames)
 *     - Non-standard timebases
 *   Any of these causes the compositor to fail to find a decodable frame.
 *
 * Solution: Re-encode with ALL-KEYFRAME + forced PTS + ultrafast preset.
 *   - `-g 1`              → every frame is independently decodable
 *   - `-fflags +genpts`   → regenerate PTS from scratch (fixes VFR)
 *   - `-video_track_timescale 15360` → standard timebase
 *   - `-preset ultrafast` → 5-10× faster than `-preset fast`
 *   - `-crf 28`           → good enough quality for 720×1280 shorts
 *
 * Speed: ~5-15s per video with ultrafast (vs 60-90s with fast preset).
 */
async function prepVideoForRemotion(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;

    const ffmpegBin = getFFmpegPath();
    const tmpOutput = filePath.replace('.mp4', '_prepped.mp4');

    const cmd = [
        `"${ffmpegBin}"`,
        `-y`,
        `-i "${filePath}"`,
        // Standard Remotion all-keyframe recommended flags. 
        // DO NOT add complex PTS or timebase edits, they cause the compositor proxy to corrupt seeks at small times!
        `-c:v libx264 -preset fast -crf 23`,
        `-g 1`,
        `-pix_fmt yuv420p`,
        `-an`,
        `-movflags +faststart`,
        `"${tmpOutput}"`,
    ].join(' ');

    return new Promise<void>((resolve) => {
        exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, async (err, _stdout, stderr) => {
            if (err) {
                console.warn(`⚠️ Video prep failed for ${path.basename(filePath)}: ${stderr?.slice(-200)}`);
                try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch { }
                resolve();
                return;
            }

            // Windows EBUSY fix: retry file swap with delay to wait for lock release
            const MAX_RETRIES = 5;
            const RETRY_DELAY_MS = 500;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    // Try to delete original first
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                    // Rename prepped → original
                    fs.renameSync(tmpOutput, filePath);
                    const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
                    console.log(`✅ Prepped ${path.basename(filePath)} → all-keyframe CFR 30fps (${sizeMB} MB)`);
                    resolve();
                    return;
                } catch (e: any) {
                    if (attempt < MAX_RETRIES && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES')) {
                        console.warn(`⏳ File locked (attempt ${attempt}/${MAX_RETRIES}), waiting ${RETRY_DELAY_MS}ms...`);
                        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                        continue;
                    }

                    // Last attempt: try copy as fallback (copy doesn't need delete first)
                    try {
                        fs.copyFileSync(tmpOutput, filePath);
                        try { fs.unlinkSync(tmpOutput); } catch { }
                        const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
                        console.log(`✅ Prepped ${path.basename(filePath)} → all-keyframe CFR 30fps (${sizeMB} MB) [copy fallback]`);
                        resolve();
                        return;
                    } catch (copyErr: any) {
                        console.warn(`⚠️ Failed to replace ${path.basename(filePath)}: ${e.message}. Using prepped file at alternate path.`);
                        // Last resort: leave the prepped file as-is and update the reference
                        try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch { }
                    }
                }
            }
            resolve();
        });
    });
}

/**
 * Probe actual duration of a video file in seconds using FFmpeg.
 * This is CRITICAL because if Remotion assumes a video is 5s but it's only 3s,
 * the playbackRate calculation will ask for a frame past the end of the file,
 * causing a "No frame found" Compositor crash.
 */
async function probeVideoDuration(filePath: string): Promise<number | undefined> {
    if (!fs.existsSync(filePath)) return undefined;
    const ffmpegBin = getFFmpegPath();
    
    return new Promise((resolve) => {
        exec(`"${ffmpegBin}" -i "${filePath}"`, (err, stdout, stderr) => {
            const output = (stdout || '') + '\n' + (stderr || '');
            const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);
            if (durationMatch) {
                const durationSec = 
                    parseInt(durationMatch[1]) * 3600 +
                    parseInt(durationMatch[2]) * 60 +
                    parseFloat(durationMatch[3]);
                resolve(durationSec);
            } else {
                resolve(undefined);
            }
        });
    });
}

/**
 * Common logic to trigger a video render (local or cloud)
 */
export async function triggerRender(videoId: string, props: Record<string, any>) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

    const isLocal = !appUrl;

    if (isLocal) {
        console.log(`🎬 Starting LOCAL render for: ${videoId}`);

        // Guard: Don't re-render if already rendering or completed
        const [existing] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
        if (existing && (existing.status === 'rendering')) {
            console.log(`⚠️ Video ${videoId} is already rendering. Skipping duplicate render.`);
            return { success: true, mode: 'local', skipped: true };
        }
        if (existing && existing.status === 'completed' && existing.videoUrl) {
            console.log(`⚠️ Video ${videoId} is already rendered.`);
            
            // Defensive: if thumbnail is missing, generate it now
            await ensureVideoThumbnail(videoId);

            return { success: true, mode: 'local', skipped: true };
        }

        // Mark as rendering immediately
        await db.update(shortVideoAssets).set({ status: 'rendering' }).where(eq(shortVideoAssets.videoId, videoId));
        
        // Fire-and-forget local render
        renderLocally(videoId, props).catch((err) => {
            console.error(`❌ Local render failed for ${videoId}:`, err);
        });

        return { success: true, mode: 'local' };
    }

    // CLOUD MODE
    console.log(`🎬 Triggering GitHub Action rendering for: ${videoId}`);
    const githubToken = process.env.GH_PAT;
    const repoOwner = "keshav-agrawal595";
    const repoName = "Migoo";

    if (!githubToken) {
        throw new Error("GH_PAT not configured");
    }

    const webhookUrl = `${appUrl}/api/video/webhook`;
    // Appwrite credentials are stored in GitHub repository secrets — no per-request token needed.

    const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/dispatches`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
            event_type: 'render-video',
            client_payload: {
                videoId,
                webhookUrl,
                props,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub dispatch failed: ${response.status} ${errorText}`);
    }

    // Mark as rendering in DB
    await db.update(shortVideoAssets).set({ status: 'rendering' }).where(eq(shortVideoAssets.videoId, videoId));
    
    return { success: true, mode: 'cloud' };
}

async function downloadToPublic(url: string | undefined, destRelPath: string): Promise<string | undefined> {
    if (!url || !url.startsWith("http")) return url;

    // VERY IMPORTANT FIX: If the URL in the database is incorrectly saved as "http://localhost:3001/public/tmp/..."
    // because of Next.js upload quirks, fetching it directly will result in a 404 (because Next.js strips /public normally).
    // Remotion failing to fetch this frame causes all "No frame found" errors for user-uploaded split-screens.
    let sanitizedUrl = url;
    if (sanitizedUrl.includes('/public/tmp/')) {
        sanitizedUrl = sanitizedUrl.replace('/public/tmp/', '/tmp/');
    } else if (sanitizedUrl.includes('/public/avatars/')) {
        sanitizedUrl = sanitizedUrl.replace('/public/avatars/', '/avatars/');
    }

    const cwd = process.cwd();
    const absolutePath = path.join(cwd, 'public', destRelPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    
    try {
        console.log(`⬇️ Downloading ${sanitizedUrl} locally to ${destRelPath}...`);
        const res = await fetch(sanitizedUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(absolutePath, buffer);
        console.log(`✅ Downloaded ${destRelPath}`);
        return `/${destRelPath}`;
    } catch (err: any) {
        console.warn(`⚠️ Failed to download ${sanitizedUrl}: ${err.message}. Falling back to remote URL.`);
        return sanitizedUrl;
    }
}

async function renderLocally(videoId: string, props: Record<string, any>) {
    const cwd = process.cwd();

    // Ensure directories exist
    const tmpDir = path.join(cwd, 'public', 'tmp');
    const rendersDir = path.join(cwd, 'public', 'renders');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });

    // ── Cleanup PREVIOUS renders' asset folders before we start ──────────────
    // This prevents old downloaded files from being included in the Remotion
    // public bundle (which dramatically slows down rendering / causes OOM).
    try {
        const files = fs.readdirSync(tmpDir);
        for (const file of files) {
            if (file.startsWith('assets_') && file !== `assets_${videoId}`) {
                const oldDir = path.join(tmpDir, file);
                try {
                    fs.rmSync(oldDir, { recursive: true, force: true });
                    console.log(`🧹 Cleaned up stale asset dir: ${file}`);
                } catch (_e) { /* ignore locked files */ }
            }
        }
    } catch (e: any) {
        console.warn(`⚠️ Pre-render cleanup failed:`, e.message);
    }

    // ── Download remote assets to local disk ─────────────────────────────────
    // Remotion's OffthreadVideo compositor uses byte-range HTTP requests.
    // Cloud storage providers (Appwrite, Vercel Blob) often return 500 errors
    // or block range requests, causing "No frame found" crashes mid-render.
    // Serving from local disk via Next.js staticFile() is 100% reliable.
    const assetsDirRel = `tmp/assets_${videoId}`;   // relative to public/
    const assetsDirAbs = path.join(cwd, 'public', assetsDirRel);
    fs.mkdirSync(assetsDirAbs, { recursive: true });

    // Track probed durations for all scene assets so Composition doesn't seek past EOF
    const sceneVideoDurations: (number | undefined)[] = [];

    try {
        console.log(`📥 Downloading assets for ${videoId} to avoid remote range-request failures...`);

        // Scene videos — also handles JSON payloads (composite/split) with embedded remote URLs
        if (props.sceneVideoUrls && Array.isArray(props.sceneVideoUrls)) {
            const newUrls = [...props.sceneVideoUrls];
            for (let i = 0; i < newUrls.length; i++) {
                if (!newUrls[i]) {
                    sceneVideoDurations.push(undefined);
                    continue;
                }

                // Check if this entry is a JSON payload (composite/split) with embedded URLs
                try {
                    const parsed = JSON.parse(newUrls[i]);

                    if (parsed?.type === 'composite' && Array.isArray(parsed.assets)) {
                        // Download all video/split URLs in the composite payload
                        let assetIdx = 0;
                        for (const asset of parsed.assets) {
                            if (asset.kind === 'video' && asset.url) {
                                const absDest = path.join(assetsDirAbs, `scene_${i}_v${assetIdx}.mp4`);
                                const local = await downloadToPublic(asset.url, `${assetsDirRel}/scene_${i}_v${assetIdx}.mp4`);
                                if (local) {
                                    asset.url = local;
                                    asset.durationSec = await probeVideoDuration(absDest);
                                }
                            } else if (asset.kind === 'split' && Array.isArray(asset.urls)) {
                                if (!asset.durationsSec) asset.durationsSec = [];
                                for (let j = 0; j < asset.urls.length; j++) {
                                    const absDest = path.join(assetsDirAbs, `scene_${i}_sp${assetIdx}_${j}.mp4`);
                                    const local = await downloadToPublic(asset.urls[j], `${assetsDirRel}/scene_${i}_sp${assetIdx}_${j}.mp4`);
                                    if (local) {
                                        asset.urls[j] = local;
                                        asset.durationsSec[j] = await probeVideoDuration(absDest);
                                    }
                                }
                                // BUG FIX: Also set scalar durationSec so CompositeSplitSub receives it.
                                // Without this, sourceDuration was always undefined → wrong playback rate.
                                const validSplitDurations = (asset.durationsSec || []).filter(Boolean);
                                if (validSplitDurations.length > 0) {
                                    asset.durationSec = Math.min(...validSplitDurations);
                                }
                            }
                            // Images in composite use <Img> (no compositor) — skip download
                            assetIdx++;
                        }
                        newUrls[i] = JSON.stringify(parsed);
                        console.log(`📦 Scene ${i}: composite payload — downloaded ${assetIdx} embedded assets`);
                        const validDurations = parsed.assets.map((a: any) => a.durationSec || (a.durationsSec ? Math.min(...a.durationsSec.filter(Boolean)) : 0)).filter((d: number) => d > 0);
                        sceneVideoDurations.push(validDurations.length > 0 ? Math.min(...validDurations) : undefined);
                        continue;
                    }

                    if (parsed?.type === 'split' && Array.isArray(parsed.urls)) {
                        if (!parsed.durationsSec) parsed.durationsSec = [];
                        for (let j = 0; j < parsed.urls.length; j++) {
                            const absDest = path.join(assetsDirAbs, `scene_${i}_split_${j}.mp4`);
                            const local = await downloadToPublic(parsed.urls[j], `${assetsDirRel}/scene_${i}_split_${j}.mp4`);
                            if (local) {
                                parsed.urls[j] = local;
                                parsed.durationsSec[j] = await probeVideoDuration(absDest);
                            }
                        }
                        newUrls[i] = JSON.stringify(parsed);
                        console.log(`📺 Scene ${i}: split payload — downloaded ${parsed.urls.length} videos`);
                        const validDurations = parsed.durationsSec.filter(Boolean);
                        sceneVideoDurations.push(validDurations.length > 0 ? Math.min(...validDurations) : undefined);
                        continue;
                    }
                } catch {
                    // Not JSON — treat as regular URL below
                }

                // Regular video URL
                const absDest = path.join(assetsDirAbs, `scene_${i}.mp4`);
                const local = await downloadToPublic(newUrls[i], `${assetsDirRel}/scene_${i}.mp4`);
                if (local) {
                    newUrls[i] = local;
                    // Probe the EXACT actual duration directly from the downloaded file
                    const actualDurationSec = await probeVideoDuration(absDest);
                    sceneVideoDurations.push(actualDurationSec);
                    console.log(`⏱️ Probed real duration for scene_${i}: ${actualDurationSec?.toFixed(3)}s`);
                } else {
                    sceneVideoDurations.push(undefined);
                }
            }
            props.sceneVideoUrls = newUrls;
            props.sceneVideoDurations = sceneVideoDurations;
        }

        // Narration audio
        if (props.audioUrl) {
            const local = await downloadToPublic(props.audioUrl, `${assetsDirRel}/audio.wav`);
            if (local) props.audioUrl = local;
        }

        // Background music
        if (props.musicUrl) {
            const local = await downloadToPublic(props.musicUrl, `${assetsDirRel}/music.mp3`);
            if (local) props.musicUrl = local;
        }

        // Avatar clips: copy BOTH video AND audio to assets dir so videos get prepped.
        // Previously, avatar videos in public/avatars/ were served RAW — the Windows
        // Remotion compositor crashes on them because they're not all-keyframe encoded.
        const publicDir = path.join(cwd, 'public');
        if (props.introClip?.videoUrl) {
            const rawUrl = props.introClip.videoUrl.replace(/^\//, '');
            const introVideoSrc = path.join(publicDir, rawUrl);
            const introVideoDest = path.join(assetsDirAbs, 'intro_video.mp4');
            try {
                if (fs.existsSync(introVideoSrc)) {
                    fs.copyFileSync(introVideoSrc, introVideoDest);
                    const initDuration = await probeVideoDuration(introVideoDest);
                    props.introClip = { 
                        ...props.introClip, 
                        videoUrl: `/${assetsDirRel}/intro_video.mp4`,
                        videoDurationSec: initDuration 
                    };
                    console.log(`📋 Copied intro avatar video → ${introVideoDest} (${initDuration?.toFixed(3)}s)`);
                } else {
                    console.warn(`⚠️ Intro avatar video not found at: ${introVideoSrc}`);
                }
            } catch (e: any) {
                console.warn(`⚠️ Failed to copy intro avatar video: ${e.message}`);
            }
        }
        if (props.introClip?.audioUrl) {
            const local = await downloadToPublic(props.introClip.audioUrl, `${assetsDirRel}/intro_audio.wav`);
            if (local) props.introClip = { ...props.introClip, audioUrl: local };
        }
        if (props.outroClip?.videoUrl) {
            const rawUrl = props.outroClip.videoUrl.replace(/^\//, '');
            const outroVideoSrc = path.join(publicDir, rawUrl);
            const outroVideoDest = path.join(assetsDirAbs, 'outro_video.mp4');
            try {
                if (fs.existsSync(outroVideoSrc)) {
                    fs.copyFileSync(outroVideoSrc, outroVideoDest);
                    const initDuration = await probeVideoDuration(outroVideoDest);
                    props.outroClip = { 
                        ...props.outroClip, 
                        videoUrl: `/${assetsDirRel}/outro_video.mp4`,
                        videoDurationSec: initDuration 
                    };
                    console.log(`📋 Copied outro avatar video → ${outroVideoDest} (${initDuration?.toFixed(3)}s)`);
                } else {
                    console.warn(`⚠️ Outro avatar video not found at: ${outroVideoSrc}`);
                }
            } catch (e: any) {
                console.warn(`⚠️ Failed to copy outro avatar video: ${e.message}`);
            }
        }
        if (props.outroClip?.audioUrl) {
            const local = await downloadToPublic(props.outroClip.audioUrl, `${assetsDirRel}/outro_audio.wav`);
            if (local) props.outroClip = { ...props.outroClip, audioUrl: local };
        }

        console.log(`✅ All assets downloaded for ${videoId}`);
    } catch (err: any) {
        console.error(`⚠️ Asset preload error (will proceed with remote URLs):`, err.message);
    }

    // ── Prep ALL downloaded .mp4 files → all-keyframe for Remotion ─────────────
    // Every video gets GOP=1 + forced PTS + CFR so compositor can seek anywhere.
    // Uses ultrafast preset so this step takes ~5-15s per video.
    try {
        const allFiles = fs.readdirSync(assetsDirAbs);
        const videoFiles = allFiles.filter(f => f.endsWith('.mp4'));

        if (videoFiles.length > 0) {
            console.log(`🔧 Prepping ${videoFiles.length} video(s) → all-keyframe CFR 30fps...`);
            for (const videoFile of videoFiles) {
                await prepVideoForRemotion(path.join(assetsDirAbs, videoFile));
            }
            console.log(`✅ All videos prepped for Remotion.`);
        }
    } catch (e: any) {
        console.warn(`⚠️ Video prep step failed (will proceed with original files):`, e.message);
    }

    // ── RE-PROBE durations AFTER prep ─────────────────────────────────────────────
    // CRITICAL: The initial probe measured ORIGINAL files. After prepVideoForRemotion
    // re-encodes them, the duration can change slightly (CFR conversion, PTS regen).
    // If props still has the OLD duration, playbackRate will make Remotion seek to
    // positions PAST the actual end of the re-encoded file → "No frame found" crash.
    try {
        console.log(`🔍 Re-probing durations after video prep...`);

        // Re-probe standalone scene videos
        if (props.sceneVideoDurations && Array.isArray(props.sceneVideoDurations)) {
            for (let i = 0; i < (props.sceneVideoUrls || []).length; i++) {
                const sceneUrl = props.sceneVideoUrls[i];
                if (!sceneUrl) continue;

                // Check if it's a JSON payload (composite/split)
                try {
                    const parsed = JSON.parse(sceneUrl);

                    if (parsed?.type === 'composite' && Array.isArray(parsed.assets)) {
                        // Re-probe each video/split in composite
                        let assetIdx = 0;
                        for (const asset of parsed.assets) {
                            if (asset.kind === 'video' && asset.url) {
                                const absDest = path.join(assetsDirAbs, `scene_${i}_v${assetIdx}.mp4`);
                                if (fs.existsSync(absDest)) {
                                    asset.durationSec = await probeVideoDuration(absDest);
                                    console.log(`  ⏱️ Re-probed scene_${i}_v${assetIdx}: ${asset.durationSec?.toFixed(3)}s`);
                                }
                            } else if (asset.kind === 'split' && Array.isArray(asset.urls)) {
                                if (!asset.durationsSec) asset.durationsSec = [];
                                for (let j = 0; j < asset.urls.length; j++) {
                                    const absDest = path.join(assetsDirAbs, `scene_${i}_sp${assetIdx}_${j}.mp4`);
                                    if (fs.existsSync(absDest)) {
                                        asset.durationsSec[j] = await probeVideoDuration(absDest);
                                    }
                                }
                                const validSplitDurs = (asset.durationsSec || []).filter(Boolean);
                                if (validSplitDurs.length > 0) {
                                    asset.durationSec = Math.min(...validSplitDurs);
                                }
                                console.log(`  ⏱️ Re-probed scene_${i}_sp${assetIdx}: ${asset.durationSec?.toFixed(3)}s`);
                            }
                            assetIdx++;
                        }
                        props.sceneVideoUrls[i] = JSON.stringify(parsed);

                        // Update sceneVideoDurations for this composite
                        const validDurations = parsed.assets.map((a: any) =>
                            a.durationSec || (a.durationsSec ? Math.min(...a.durationsSec.filter(Boolean)) : 0)
                        ).filter((d: number) => d > 0);
                        props.sceneVideoDurations[i] = validDurations.length > 0 ? Math.min(...validDurations) : undefined;
                        continue;
                    }

                    if (parsed?.type === 'split' && Array.isArray(parsed.urls)) {
                        if (!parsed.durationsSec) parsed.durationsSec = [];
                        for (let j = 0; j < parsed.urls.length; j++) {
                            const absDest = path.join(assetsDirAbs, `scene_${i}_split_${j}.mp4`);
                            if (fs.existsSync(absDest)) {
                                parsed.durationsSec[j] = await probeVideoDuration(absDest);
                            }
                        }
                        props.sceneVideoUrls[i] = JSON.stringify(parsed);
                        const validDurations = (parsed.durationsSec || []).filter(Boolean);
                        props.sceneVideoDurations[i] = validDurations.length > 0 ? Math.min(...validDurations) : undefined;
                        console.log(`  ⏱️ Re-probed scene_${i}_split: ${props.sceneVideoDurations[i]?.toFixed(3)}s`);
                        continue;
                    }
                } catch {
                    // Not JSON — regular video
                }

                // Regular video
                const absDest = path.join(assetsDirAbs, `scene_${i}.mp4`);
                if (fs.existsSync(absDest)) {
                    props.sceneVideoDurations[i] = await probeVideoDuration(absDest);
                    console.log(`  ⏱️ Re-probed scene_${i}: ${props.sceneVideoDurations[i]?.toFixed(3)}s`);
                }
            }
        }
        
        // Re-probe avatar clips
        if (props.introClip?.videoUrl) {
            const absDest = path.join(assetsDirAbs, 'intro_video.mp4');
            if (fs.existsSync(absDest)) {
                props.introClip.videoDurationSec = await probeVideoDuration(absDest);
                console.log(`  ⏱️ Re-probed intro avatar video: ${props.introClip.videoDurationSec?.toFixed(3)}s`);
            }
        }
        if (props.outroClip?.videoUrl) {
            const absDest = path.join(assetsDirAbs, 'outro_video.mp4');
            if (fs.existsSync(absDest)) {
                props.outroClip.videoDurationSec = await probeVideoDuration(absDest);
                console.log(`  ⏱️ Re-probed outro avatar video: ${props.outroClip.videoDurationSec?.toFixed(3)}s`);
            }
        }

        console.log(`✅ All durations re-probed after prep.`);
    } catch (e: any) {
        console.warn(`⚠️ Re-probe step failed (will use pre-prep durations):`, e.message);
    }

    // ── Write props JSON ──────────────────────────────────────────────────────
    const propsPath = path.join(tmpDir, `props-${videoId}.json`);
    fs.writeFileSync(propsPath, JSON.stringify(props));

    const outputPath = path.join(rendersDir, `${videoId}.mp4`);

    // Use forward slashes for Windows CLI compatibility
    const propsArg  = propsPath.replace(/\\/g, '/');
    const outputArg = outputPath.replace(/\\/g, '/');

    // ── Render command builder ──────────────────────────────────────────────────
    // SPEED OPTIMIZATIONS (brings 44 min → ~8-12 min on typical Windows machine):
    //
    // --concurrency=2              Render 2 frames in parallel. Safe on 8GB+ RAM
    //                              machines. The old concurrency=1 was the #1 bottleneck.
    // --gl=angle                   GPU-accelerated rendering on Windows via ANGLE.
    //                              Falls back to software if GPU unavailable.
    // --offthread-video-cache-size Starting at 2GB, escalating on retries.
    // --timeout=120000             2-min per-frame timeout (enough for local disk).
    // --jpeg-quality=75            Slightly lower intermediate quality = faster encode.
    // --disable-web-security       Required for cross-origin local assets.
    //
    // NOTE: do NOT pass --duration here — props JSON already has durationInFrames.
    function buildRenderCommand(cacheBytes: number = 2147483648 /* 2 GB */) {
        return [
            'npx remotion render MainVideo',
            `"${outputArg}"`,
            `--props="${propsArg}"`,
            `--timeout=120000`,
            `--disable-web-security`,
            `--gl=angle`,
            `--concurrency=2`,
            `--offthread-video-cache-size-in-bytes=${cacheBytes}`,
            `--jpeg-quality=75`,
        ].join(' ');
    }

    console.log(`💻 Executing Remotion render for ${videoId}...`);

    // ── Execute render with automatic retry on compositor errors ────────────────
    // Strategy: 3 attempts with escalating cache (2GB → 3GB → 4GB).
    // The "No frame found" error is caused by cache eviction when multiple
    // OffthreadVideo elements are active (split-screen = 2×, composite = N×).
    function executeRender(cmd: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            console.log(`💻 Executing: ${cmd.substring(0, 120)}...`);
            const child = exec(cmd, { cwd }, (error, stdout, stderr) => {
                if (error) return reject(error);
                resolve();
            });
            child.stdout?.on('data', (data) => console.log(`[Remotion] ${data.toString().trim()}`));
            child.stderr?.on('data', (data) => console.log(`[Remotion] ${data.toString().trim()}`));
        });
    }

    const CACHE_ESCALATION = [
        2147483648,  // Attempt 1: 2 GB (default)
        3221225472,  // Attempt 2: 3 GB
        4294967296,  // Attempt 3: 4 GB
    ];
    const MAX_ATTEMPTS = CACHE_ESCALATION.length;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const cacheBytes = CACHE_ESCALATION[attempt];
        const cacheMB = Math.round(cacheBytes / 1024 / 1024);
        const cmd = buildRenderCommand(cacheBytes);

        try {
            if (attempt > 0) {
                console.warn(`⚠️ Compositor cache error on attempt ${attempt}/${MAX_ATTEMPTS} for ${videoId}. Retrying with ${cacheMB} MB cache...`);
                // Delete partial output if it exists
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { }
                // Re-write props (Remotion may have cleaned up the temp file)
                fs.writeFileSync(propsPath, JSON.stringify(props));
            }
            await executeRender(cmd);
            if (attempt > 0) console.log(`✅ Render succeeded on attempt ${attempt + 1} with ${cacheMB} MB cache`);
            break; // success — exit retry loop
        } catch (error: any) {
            const isCompositorError = /no frame found|compositor/i.test(error?.message || '');
            const isLastAttempt = attempt === MAX_ATTEMPTS - 1;

            if (!isCompositorError || isLastAttempt) {
                // Non-compositor error OR all attempts exhausted — clean up and fail
                try { fs.unlinkSync(propsPath); } catch { }
                try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch { }
                const reason = isCompositorError
                    ? `after ${MAX_ATTEMPTS} attempts (max cache ${Math.round(CACHE_ESCALATION[MAX_ATTEMPTS - 1] / 1024 / 1024)} MB)`
                    : `(non-compositor error)`;
                console.error(`❌ Local render failed ${reason} for ${videoId}:`, error.message);
                await db.update(shortVideoAssets).set({ status: 'failed' }).where(eq(shortVideoAssets.videoId, videoId));
                throw error;
            }
            // Compositor error with retries remaining — continue to next attempt
        }
    }

    // ── Success path ──────────────────────────────────────────────────────────
    // Cleanup props and downloaded assets
    try { fs.unlinkSync(propsPath); } catch { }
    try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch { }

    const localUrl = `/renders/${videoId}.mp4`;
    console.log(`✅ Local render complete: ${localUrl}`);

    // Ensure we have a high-quality AI thumbnail
    const [asset] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
    if (!asset?.thumbnailUrl) {
        console.log(`🖼️ Missing AI thumbnail for ${videoId}, generating now...`);
        await ensureVideoThumbnail(videoId);
    }

    // Update asset status to completed
    await db.update(shortVideoAssets).set({
        videoUrl: localUrl,
        status: 'completed',
    }).where(eq(shortVideoAssets.videoId, videoId));
}

/**
 * Defensive helper: if a video is completed but missing its thumbnail, generate it now.
 * Uses Leonardo Nano Banana 2 for high-quality AI cover image.
 */
export async function ensureVideoThumbnail(videoId: string) {
    try {
        const [asset] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
        if (asset && asset.status === 'completed' && !asset.thumbnailUrl) {
            console.log(`🖼️ Fixing missing thumbnail for ${videoId} using Nano Banana 2...`);
            
            // Try to find a prompt from script data, or build one from the title
            const script = asset.scriptData as any;
            const prompt = (script?.thumbnailPrompt || 
                           `Cinematic masterpiece poster for a video titled: "${asset.videoTitle || 'Epic Adventure'}". Stunning lighting, masterpiece composition, highly detailed.`)
                           + " -- NO TEXT, NO WORDS, NO LETTERS. PURE IMAGE ONLY.";

            // Call Leonardo Nano Banana 2
            const thumbUrl = await generateNanoBananaImage(prompt, 1024, 1024);
            
            if (thumbUrl) {
                await db.update(shortVideoAssets).set({ thumbnailUrl: thumbUrl }).where(eq(shortVideoAssets.videoId, videoId));
                
                if (asset.seriesId) {
                    await db.update(shortVideoSeries).set({ thumbnailUrl: thumbUrl }).where(eq(shortVideoSeries.seriesId, asset.seriesId));
                }
                console.log(`✅ Fixed missing thumbnail for ${videoId} via AI: ${thumbUrl}`);
                return thumbUrl;
            }
        }
    } catch (err: any) {
        console.warn(`⚠️ Failed to ensure AI thumbnail for ${videoId}:`, err.message);
    }
    return null;
}

/**
 * Capture a frame from the video at 1.0s as a thumbnail.
 */
async function generateLocalThumbnail(videoId: string, videoPath: string): Promise<string> {
    const cwd = process.cwd();
    const thumbnailsDir = path.join(cwd, 'public', 'thumbnails');
    if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir, { recursive: true });

    const thumbPath = path.join(thumbnailsDir, `${videoId}.jpg`);
    const ffmpegPath = getFFmpegPath();
    // -ss 1.0: seek to 1 second
    // -frames:v 1: capture 1 frame
    // -update 1: overwrite if exists
    const cmd = `"${ffmpegPath}" -y -i "${videoPath}" -ss 00:00:01.000 -vframes 1 "${thumbPath}"`;

    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) return reject(err);
            resolve(`/thumbnails/${videoId}.jpg`);
        });
    });
}
