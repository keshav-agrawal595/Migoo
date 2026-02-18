import { db } from "@/config/db";
import { coursesTable } from "@/config/schema";
import { generateDeAPIImage } from "@/lib/deapi";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════════
// DeAPI AI THUMBNAIL GENERATION — One thumbnail per course
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a visually striking thumbnail prompt from the course name
 */
function buildThumbnailPrompt(courseName: string): string {
    return `Professional course thumbnail banner with bold large title text "${courseName}" prominently displayed in the center, with a catchy subtitle tagline below it, modern dark gradient background with vibrant neon accent colors, sleek typography, cinematic lighting, tech-inspired educational visual, premium course cover design like Udemy or YouTube thumbnail, ultra high quality`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN API ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
    try {
        const { courseId, courseName } = await req.json();

        console.log('\n' + '═'.repeat(80));
        console.log('🖼️  DeAPI THUMBNAIL GENERATION');
        console.log('═'.repeat(80));
        console.log('Course:', courseName);
        console.log('Course ID:', courseId);
        console.log('═'.repeat(80) + '\n');

        if (!courseId || !courseName) {
            return NextResponse.json(
                { error: 'courseId and courseName are required' },
                { status: 400 }
            );
        }

        // ═════════════════════════════════════════════════════════════════
        // CHECK IF THUMBNAIL ALREADY EXISTS
        // ═════════════════════════════════════════════════════════════════
        const existingCourse = await db
            .select({ courseThumbnail: coursesTable.courseThumbnail })
            .from(coursesTable)
            .where(eq(coursesTable.courseId, courseId));

        if (existingCourse[0]?.courseThumbnail) {
            console.log(`✅ Thumbnail already exists for course ${courseId} — SKIPPING`);
            return NextResponse.json({
                success: true,
                thumbnailUrl: existingCourse[0].courseThumbnail,
                skipped: true,
                message: 'Thumbnail already generated'
            });
        }

        // ═════════════════════════════════════════════════════════════════
        // GENERATE THUMBNAIL via DeAPI (with auto key rotation)
        // ═════════════════════════════════════════════════════════════════
        const prompt = buildThumbnailPrompt(courseName);
        console.log('📸 Thumbnail prompt:', prompt);
        console.log('📸 Calling DeAPI txt2img (768×432, 4 steps, auto-rotating keys)...');

        const thumbnailUrl = await generateDeAPIImage(prompt, 768, 432, 4);
        console.log(`✅ Thumbnail ready: ${thumbnailUrl.substring(0, 80)}...`);

        // Update course in DB
        await db.update(coursesTable)
            .set({ courseThumbnail: thumbnailUrl })
            .where(eq(coursesTable.courseId, courseId));

        console.log('💾 Thumbnail URL saved to database');

        console.log('\n' + '═'.repeat(80));
        console.log('🎉 THUMBNAIL GENERATION COMPLETE');
        console.log('═'.repeat(80) + '\n');

        return NextResponse.json({
            success: true,
            thumbnailUrl,
            metadata: {
                generatedAt: new Date().toISOString(),
                engine: 'deapi-flux1schnell',
                courseId,
                prompt: prompt.substring(0, 200)
            }
        });

    } catch (error: any) {
        console.error('\n' + '═'.repeat(80));
        console.error('🔥 THUMBNAIL GENERATION FAILED');
        console.error('═'.repeat(80));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('═'.repeat(80) + '\n');

        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to generate thumbnail',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            { status: 500 }
        );
    }
}
