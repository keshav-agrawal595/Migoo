import { inngest } from "@/inngest/client";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { seriesId } = await req.json();

        if (!seriesId) {
            return NextResponse.json(
                { error: "seriesId is required" },
                { status: 400 }
            );
        }

        // Send event to Inngest to trigger video generation
        await inngest.send({
            name: "shorts/generate.video",
            data: { seriesId },
        });

        return NextResponse.json({
            success: true,
            message: "Video generation started",
        });
    } catch (error: any) {
        console.error("Error triggering video generation:", error);
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
