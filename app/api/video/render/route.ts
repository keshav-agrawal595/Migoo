import { db } from "@/config/db";
import { shortVideoAssets, shortVideoSeries } from "@/config/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { triggerRender } from "@/lib/video-render";

/**
 * API to trigger MP4 rendering for a short video.
 */
export async function POST(req: Request) {
    try {
        const { videoId } = await req.json();

        if (!videoId) {
            return NextResponse.json({ success: false, error: "Missing videoId" }, { status: 400 });
        }

        // 1. Fetch video assets
        const [video] = await db.select().from(shortVideoAssets).where(eq(shortVideoAssets.videoId, videoId));
        if (!video) {
            return NextResponse.json({ success: false, error: "Video not found" }, { status: 404 });
        }

        // 2. Fetch series config for additional props
        const [series] = await db.select().from(shortVideoSeries).where(eq(shortVideoSeries.seriesId, video.seriesId));

        // 3. Prepare props for Remotion
        const props = {
            imageUrls: video.imageUrls,
            audioUrl: video.audioUrl,
            captionData: video.captionData,
            captionStyle: series?.captionStyle || 'bold-pop',
            language: series?.language || 'en-IN',
            durationInFrames: Math.floor((video.audioDuration || 60) * 30),
        };

        // 4. Trigger rendering
        const result = await triggerRender(videoId, props);

        return NextResponse.json({ 
            success: true, 
            message: result.mode === 'local' 
                ? "Local rendering started (Remotion CLI)" 
                : "Cloud rendering triggered via GitHub Actions" 
        });

    } catch (error: any) {
        console.error("❌ Render trigger API error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
