import { db } from "@/config/db";
import { shortVideoAssets, shortVideoSeries } from "@/config/schema";
import { getBlobToken } from "@/lib/blob";
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
    const blobToken = getBlobToken();

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
                blobToken,
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

async function renderLocally(videoId: string, props: Record<string, any>) {
    const cwd = process.cwd();

    // Ensure directories exist
    const tmpDir = path.join(cwd, 'public', 'tmp');
    const rendersDir = path.join(cwd, 'public', 'renders');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });

    // Avatar clips are pre-transcoded CFR files in public/avatars/ — no download needed.
    // staticFile() in Composition.tsx resolves them directly from the public directory.

    // Write props to a temp JSON file
    const propsPath = path.join(tmpDir, `props-${videoId}.json`);
    fs.writeFileSync(propsPath, JSON.stringify(props));

    const outputPath = path.join(rendersDir, `${videoId}.mp4`);

    // Use forward slashes for CLI compatibility
    const propsArg = propsPath.replace(/\\/g, '/');
    const outputArg = outputPath.replace(/\\/g, '/');
    const command = `npx remotion render MainVideo "${outputArg}" --props="${propsArg}" --duration=${props.durationInFrames} --timeout=120000 --disable-web-security --concurrency=3 --offthread-video-cache-size-in-bytes=2147483648`;

    console.log(`💻 Executing: ${command}`);

    return new Promise<void>((resolve, reject) => {
        const child = exec(command, { cwd }, async (error, stdout, stderr) => {
            // Clean up temp props file
            try { fs.unlinkSync(propsPath); } catch { }

            if (error) {
                console.error(`❌ Local render error for ${videoId}:`, error.message);
                await db.update(shortVideoAssets).set({ status: 'failed' }).where(eq(shortVideoAssets.videoId, videoId));
                return reject(error);
            }

            const localUrl = `/renders/${videoId}.mp4`;
            console.log(`✅ Local render complete: ${localUrl}`);

            // Ensure we have a high-quality AI thumbnail (Gemini 2.5 Flash)
            const [asset] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
            if (!asset?.thumbnailUrl) {
                console.log(`🖼️ Missing AI thumbnail for ${videoId}, generating now...`);
                // This triggers the Runway Gemini model
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
