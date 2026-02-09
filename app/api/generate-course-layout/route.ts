import { db } from "@/config/db";
import { groq } from "@/config/groq";
import { coursesTable } from "@/config/schema";
import { COURSE_CONFIG_PROMPT } from "@/data/Prompt";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    const user = await currentUser();

    console.log('\n' + '═'.repeat(80));
    console.log('🚀 Course Layout Generation API Called');
    console.log('═'.repeat(80));
    console.log('📅 Timestamp:', new Date().toISOString());

    try {
        // Parse request body
        const body = await req.json();
        const { userInput, courseId, type } = body;

        console.log('📥 Request Body:', {
            userInputLength: userInput?.length,
            courseId,
            type,
            bodyKeys: Object.keys(body)
        });

        console.log('📋 User Input:', userInput);

        // ═══════════════════════════════════════════════════════════════════
        // Validate input
        // ═══════════════════════════════════════════════════════════════════
        if (!userInput) {
            console.error('❌ Validation Error: userInput is required');
            return NextResponse.json(
                { error: 'userInput is required' },
                { status: 400 }
            );
        }

        if (!courseId) {
            console.error('❌ Validation Error: courseId is required');
            return NextResponse.json(
                { error: 'courseId is required' },
                { status: 400 }
            );
        }

        if (!type) {
            console.error('❌ Validation Error: type is required');
            return NextResponse.json(
                { error: 'type is required' },
                { status: 400 }
            );
        }

        if (!user?.primaryEmailAddress?.emailAddress) {
            console.error('❌ Validation Error: User not authenticated');
            return NextResponse.json(
                { error: 'User not authenticated' },
                { status: 401 }
            );
        }

        // ═══════════════════════════════════════════════════════════════════
        // Test API connection
        // ═══════════════════════════════════════════════════════════════════
        console.log('🔗 Testing Groq API connection...');
        try {
            await groq.test();
            console.log('✅ Groq API connection successful');
        } catch (error: any) {
            console.error('❌ Groq API Connection Test Failed:', error.message);
            return NextResponse.json(
                {
                    error: 'Groq API connection failed',
                    details: error.message,
                    suggestion: 'Check your NEXT_PUBLIC_GROQ_API_KEY in .env.local'
                },
                { status: 500 }
            );
        }

        // ═══════════════════════════════════════════════════════════════════
        // Generate comprehensive course layout
        // ═══════════════════════════════════════════════════════════════════
        console.log('🤖 Generating comprehensive course layout with Groq AI...');
        console.log('Model: openai/gpt-oss-120b');
        console.log('Temperature: 0.7 (balanced creativity)');
        console.log('Max Tokens: 8000 (increased for detailed courses)');

        const result = await groq.json(
            COURSE_CONFIG_PROMPT,
            userInput,
            {
                model: 'openai/gpt-oss-120b',
                temperature: 0.7,
                max_tokens: 8000  // Increased for longer, more detailed courses
            }
        );

        console.log('✅ Groq API Response Received');
        console.log('📊 Course Layout Statistics:', {
            courseName: result.courseName,
            courseId: result.courseId,
            level: result.level,
            totalChapters: result.totalChapters,
            chaptersGenerated: result.chapters?.length,
            firstChapterTitle: result.chapters?.[0]?.chapterTitle,
            firstChapterSubContentCount: result.chapters?.[0]?.subContent?.length
        });

        // Validate course structure
        if (!result.chapters || result.chapters.length === 0) {
            throw new Error('AI generated course with no chapters');
        }

        if (result.chapters.length < 5) {
            console.warn(`⚠️ WARNING: Course only has ${result.chapters.length} chapters. Expected 8-15 for comprehensive course.`);
        }

        // Validate each chapter has sufficient subcontent
        const insufficientChapters = result.chapters.filter((ch: any) =>
            !ch.subContent || ch.subContent.length < 5
        );

        if (insufficientChapters.length > 0) {
            console.warn(`⚠️ WARNING: ${insufficientChapters.length} chapters have fewer than 5 subContent items`);
            insufficientChapters.forEach((ch: any) => {
                console.warn(`  - ${ch.chapterTitle}: ${ch.subContent?.length || 0} items`);
            });
        }

        // Log detailed chapter breakdown
        console.log('\n📚 Generated Course Structure:');
        console.log('═'.repeat(80));
        result.chapters.forEach((chapter: any, index: number) => {
            console.log(`Chapter ${index + 1}: ${chapter.chapterTitle}`);
            console.log(`  - ID: ${chapter.chapterId}`);
            console.log(`  - SubContent Items: ${chapter.subContent?.length}`);
            chapter.subContent?.forEach((item: string, idx: number) => {
                console.log(`    ${idx + 1}. ${item.substring(0, 60)}${item.length > 60 ? '...' : ''}`);
            });
            console.log('─'.repeat(80));
        });
        console.log('═'.repeat(80) + '\n');

        // ═══════════════════════════════════════════════════════════════════
        // Save to database
        // ═══════════════════════════════════════════════════════════════════
        console.log('💾 Saving course layout to database...');

        const courseResult = await db.insert(coursesTable).values({
            courseId: courseId,
            courseName: result.courseName,
            userInput: userInput,
            type: type,
            courseLayout: result,
            userId: user?.primaryEmailAddress?.emailAddress
        }).returning();

        console.log('✅ Course saved to database successfully');
        console.log('Database ID:', courseResult[0].id);

        // ═══════════════════════════════════════════════════════════════════
        // Return success response
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(80));
        console.log('🎉 Course Layout Generation Complete!');
        console.log('═'.repeat(80));
        console.log(`Course: ${result.courseName}`);
        console.log(`Chapters: ${result.totalChapters}`);
        console.log(`Level: ${result.level}`);
        console.log(`Course ID: ${courseId}`);
        console.log('═'.repeat(80) + '\n');

        return NextResponse.json({
            success: true,
            data: courseResult[0],
            metadata: {
                generatedAt: new Date().toISOString(),
                model: 'openai/gpt-oss-120b',
                courseId,
                type,
                courseName: result.courseName,
                totalChapters: result.totalChapters,
                chaptersGenerated: result.chapters.length,
                avgSubContentPerChapter: (
                    result.chapters.reduce((sum: number, ch: any) => sum + (ch.subContent?.length || 0), 0) /
                    result.chapters.length
                ).toFixed(1)
            }
        });

    } catch (error: any) {
        console.error('\n' + '═'.repeat(80));
        console.error('🔥 Course Layout Generation Failed');
        console.error('═'.repeat(80));
        console.error('Error Message:', error.message);
        console.error('Error Name:', error.name);
        if (error.stack) {
            console.error('Stack Trace:');
            console.error(error.stack);
        }
        console.error('═'.repeat(80) + '\n');

        return NextResponse.json(
            {
                error: 'Failed to generate course layout',
                details: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            { status: 500 }
        );
    }
}

// Add OPTIONS method for CORS
export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}