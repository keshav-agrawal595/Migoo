import { db } from "@/config/db";
import { shortVideoSeries, shortVideoAssets } from "@/config/schema";
import { eq, and, or } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(
    req: Request,
    { params }: { params: { seriesId: string } }
) {
    try {
        const { seriesId } = params;

        console.log(`🧹 Manually resetting status for series: ${seriesId}`);

        // 1. Reset series status to completed to hide generating UI
        await db.update(shortVideoSeries)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(shortVideoSeries.seriesId, seriesId));

        // 2. Mark any stuck video assets as failed
        await db.update(shortVideoAssets)
            .set({ status: "failed" })
            .where(and(
                eq(shortVideoAssets.seriesId, seriesId),
                or(
                    eq(shortVideoAssets.status, "processing"),
                    eq(shortVideoAssets.status, "rendering")
                )
            ));

        return NextResponse.json({ success: true, message: "Status reset successfully" });
    } catch (error: any) {
        console.error("❌ Failed to reset status:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
