import { db } from "@/config/db";
import { chapterContentSlides, coursesTable } from "@/config/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const courseId = req.nextUrl.searchParams.get('courseId');

    // In your /api/course route, add a join query:
    const course = await db.select().from(coursesTable).where(eq(coursesTable.courseId, courseId as string));

    // Get all slides for this course
    const slides = await db.select().from(chapterContentSlides).where(eq(chapterContentSlides.courseId, courseId as string));

    // Return combined data
    return NextResponse.json({
        ...course[0],
        chapterContentSlides: slides
    });
}