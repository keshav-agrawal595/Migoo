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
    
    const cwd = process.cwd();
    const absolutePath = path.join(cwd, 'public', destRelPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    
    try {
        console.log(`⬇️ Downloading ${url} locally to ${destRelPath}...`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(absolutePath, buffer);
        console.log(`✅ Downloaded ${destRelPath}`);
        return `/${destRelPath}`;
    } catch (err: any) {
        console.warn(`⚠️ Failed to download ${url}: ${err.message}. Falling back to remote URL.`);
        return url;
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

    try {
        console.log(`📥 Downloading assets for ${videoId} to avoid remote range-request failures...`);

        // Scene videos
        if (props.sceneVideoUrls && Array.isArray(props.sceneVideoUrls)) {
            const newUrls = [...props.sceneVideoUrls];
            for (let i = 0; i < newUrls.length; i++) {
                if (newUrls[i]) {
                    const local = await downloadToPublic(newUrls[i], `${assetsDirRel}/scene_${i}.mp4`);
                    if (local) newUrls[i] = local;
                }
            }
            props.sceneVideoUrls = newUrls;
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

        // Avatar audio (video clips live in public/avatars/ already — don't re-download video)
        if (props.introClip?.audioUrl) {
            const local = await downloadToPublic(props.introClip.audioUrl, `${assetsDirRel}/intro_audio.wav`);
            if (local) props.introClip = { ...props.introClip, audioUrl: local };
        }
        if (props.outroClip?.audioUrl) {
            const local = await downloadToPublic(props.outroClip.audioUrl, `${assetsDirRel}/outro_audio.wav`);
            if (local) props.outroClip = { ...props.outroClip, audioUrl: local };
        }

        console.log(`✅ All assets downloaded for ${videoId}`);
    } catch (err: any) {
        console.error(`⚠️ Asset preload error (will proceed with remote URLs):`, err.message);
    }

    // ── Write props JSON ──────────────────────────────────────────────────────
    const propsPath = path.join(tmpDir, `props-${videoId}.json`);
    fs.writeFileSync(propsPath, JSON.stringify(props));

    const outputPath = path.join(rendersDir, `${videoId}.mp4`);

    // Use forward slashes for Windows CLI compatibility
    const propsArg  = propsPath.replace(/\\/g, '/');
    const outputArg = outputPath.replace(/\\/g, '/');

    // ── Render command ────────────────────────────────────────────────────────
    // --concurrency=1              Prevents Windows OOM when multiple threads
    //                              simultaneously decode video files.
    // --offthread-video-cache-size 512MB limit — safer for Windows machines.
    //                              1GB was causing OOM with multiple Kling clips.
    // --timeout=300000             5-min per-frame timeout (generous for slow HDD).
    // --disable-web-security       Required for cross-origin local assets.
    // --jpeg-quality=80            Reduces intermediate frame size for faster encoding.
    // NOTE: do NOT pass --duration here — props JSON already has durationInFrames.
    //       Passing both can cause Remotion CLI to ignore the props value.
    const command = [
        'npx remotion render MainVideo',
        `"${outputArg}"`,
        `--props="${propsArg}"`,
        `--timeout=300000`,
        `--disable-web-security`,
        `--concurrency=1`,
        `--offthread-video-cache-size-in-bytes=536870912`,
        `--jpeg-quality=80`,
    ].join(' ');

    console.log(`💻 Executing Remotion render for ${videoId}...`);

    return new Promise<void>((resolve, reject) => {
        const child = exec(command, { cwd }, async (error, stdout, stderr) => {
            // ── Cleanup props file (keep assets until after DB write) ──
            try { fs.unlinkSync(propsPath); } catch { }

            if (error) {
                // Cleanup assets on failure
                try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch { }
                console.error(`❌ Local render error for ${videoId}:`, error.message);
                await db.update(shortVideoAssets).set({ status: 'failed' }).where(eq(shortVideoAssets.videoId, videoId));
                return reject(error);
            }

            const localUrl = `/renders/${videoId}.mp4`;
            console.log(`✅ Local render complete: ${localUrl}`);

            // Cleanup downloaded assets after successful render
            try { fs.rmSync(assetsDirAbs, { recursive: true, force: true }); } catch { }

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

            resolve();
        });

        child.stdout?.on('data', (data) => console.log(`[Remotion] ${data.toString().trim()}`));
        child.stderr?.on('data', (data) => console.log(`[Remotion] ${data.toString().trim()}`));
    });
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
