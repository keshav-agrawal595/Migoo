import { db } from "@/config/db";
import { shortVideoAssets } from "@/config/schema";
import { getBlobToken } from "@/lib/blob";
import { eq } from "drizzle-orm";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

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
            console.log(`⚠️ Video ${videoId} is already rendered. Skipping.`);
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
    const tmpDir = path.join(cwd, 'tmp');
    const rendersDir = path.join(cwd, 'public', 'renders');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    if (!fs.existsSync(rendersDir)) fs.mkdirSync(rendersDir, { recursive: true });

    // Write props to a temp JSON file
    const propsPath = path.join(tmpDir, `props-${videoId}.json`);
    fs.writeFileSync(propsPath, JSON.stringify(props));

    const outputPath = path.join(rendersDir, `${videoId}.mp4`);

    // Use forward slashes for CLI compatibility
    const propsArg = propsPath.replace(/\\/g, '/');
    const outputArg = outputPath.replace(/\\/g, '/');
    const command = `npx remotion render MainVideo "${outputArg}" --props="${propsArg}" --duration=${props.durationInFrames} --timeout=120000`;

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
