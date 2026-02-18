import { db } from "@/config/db";
import { courseImages } from "@/config/schema";
import { generateDeAPIImage } from "@/lib/deapi";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════════
// DeAPI IMAGE GENERATION — Multiple Images Per Chapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a unique image prompt for each subcontent topic
 */
function buildImagePrompt(
    courseName: string,
    chapterTitle: string,
    subContentTopic: string,
    globalIndex: number
): string {
    const styles = [
        "cinematic wide-angle photograph",
        "professional digital illustration",
        "futuristic concept art with neon accents",
        "minimalist modern flat design",
        "isometric 3D render with soft lighting",
        "photorealistic close-up visualization",
        "abstract geometric art with gradient colors",
        "sleek tech-inspired infographic style",
        "dramatic low-angle editorial photograph",
        "watercolor-inspired digital painting"
    ];
    const style = styles[globalIndex % styles.length];

    return `${style} representing "${subContentTopic}" in the context of "${chapterTitle}", dark moody background, vibrant accent lighting, professional educational visual, ultra high quality`;
}

// How many images to generate per chapter
const IMAGES_PER_CHAPTER = 1;

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN API ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
    try {
        const { courseName, courseId, chapters } = await req.json();

        console.log('\n' + '═'.repeat(80));
        console.log('🖼️  DeAPI IMAGE GENERATION (SEQUENTIAL MODE)');
        console.log('═'.repeat(80));
        console.log('Course:', courseName);
        console.log('Course ID:', courseId);
        console.log('Chapters:', chapters?.length);
        console.log('Images per chapter:', IMAGES_PER_CHAPTER);
        console.log('═'.repeat(80) + '\n');

        if (!courseName || !courseId || !chapters) {
            return NextResponse.json(
                { error: 'courseName, courseId, and chapters are required' },
                { status: 400 }
            );
        }

        // ═════════════════════════════════════════════════════════════════
        // CHECK IF IMAGES ALREADY EXIST
        // ═════════════════════════════════════════════════════════════════
        const existingImages = await db
            .select()
            .from(courseImages)
            .where(eq(courseImages.courseId, courseId));

        if (existingImages.length > 0) {
            console.log(`✅ Images already exist for course ${courseId} (${existingImages.length} images) — SKIPPING`);
            return NextResponse.json({
                success: true,
                data: existingImages,
                skipped: true,
                message: `Images already generated (${existingImages.length} images)`
            });
        }

        // ═════════════════════════════════════════════════════════════════
        // GENERATE IMAGES — One at a time (with auto key rotation)
        // ═════════════════════════════════════════════════════════════════
        const generatedImages = [];
        let globalIndex = 0;

        for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
            const chapter = chapters[chIdx];
            const chapterTitle = chapter.chapterTitle || chapter.title || `Chapter ${chIdx + 1}`;
            const subContent: string[] = chapter.subContent || [];

            // Pick subcontent topics for image prompts
            const topicsForImages = subContent.slice(0, IMAGES_PER_CHAPTER);
            while (topicsForImages.length < IMAGES_PER_CHAPTER) {
                topicsForImages.push(`${chapterTitle} - concept ${topicsForImages.length + 1}`);
            }

            console.log(`\n📁 Chapter ${chIdx + 1}: "${chapterTitle}" — generating ${topicsForImages.length} images`);

            for (let imgIdx = 0; imgIdx < topicsForImages.length; imgIdx++) {
                const prompt = buildImagePrompt(courseName, chapterTitle, topicsForImages[imgIdx], globalIndex);

                try {
                    console.log(`  📸 [${globalIndex + 1}] Generating image...`);
                    const imageUrl = await generateDeAPIImage(prompt, 768, 432, 4);
                    console.log(`  ✅ [${globalIndex + 1}] Image ready: ${imageUrl.substring(0, 60)}...`);

                    // Save to DB
                    const [inserted] = await db.insert(courseImages).values({
                        courseId: courseId,
                        imageIndex: globalIndex,
                        imagePrompt: prompt.substring(0, 500),
                        imageUrl: imageUrl,
                        width: 768,
                        height: 432
                    }).returning();

                    generatedImages.push(inserted);
                    console.log(`  💾 [${globalIndex + 1}] Saved to DB`);

                } catch (error: any) {
                    console.error(`  ❌ [${globalIndex + 1}] Failed: ${error.message}`);
                    // Continue with next image
                }

                globalIndex++;
            }
        }

        // Summary
        const totalExpected = chapters.length * IMAGES_PER_CHAPTER;
        console.log('\n' + '═'.repeat(80));
        console.log(`🎉 IMAGE GENERATION COMPLETE: ${generatedImages.length}/${totalExpected} images`);
        console.log(`📊 ${generatedImages.length} unique images across ${chapters.length} chapters`);
        console.log('═'.repeat(80) + '\n');

        return NextResponse.json({
            success: true,
            data: generatedImages,
            metadata: {
                generatedAt: new Date().toISOString(),
                engine: 'deapi-flux1schnell',
                courseId,
                totalRequested: totalExpected,
                totalGenerated: generatedImages.length,
                imagesPerChapter: IMAGES_PER_CHAPTER,
                chapters: chapters.length
            }
        });

    } catch (error: any) {
        console.error('\n' + '═'.repeat(80));
        console.error('🔥 IMAGE GENERATION FAILED');
        console.error('═'.repeat(80));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('═'.repeat(80) + '\n');

        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to generate images',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            { status: 500 }
        );
    }
}
