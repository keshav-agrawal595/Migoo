import { db } from "@/config/db";
import { groq } from "@/config/groq";
import { coursesTable } from "@/config/schema";
import { COURSE_CONFIG_PROMPT } from "@/data/Prompt";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {

    const user = await currentUser();
    console.log('🚀 Course Layout Generation API Called');
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

        // Validate input
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

        // Test API connection first
        console.log('🔗 Testing Groq API connection...');
        try {
            await groq.test();
        } catch (error: any) {
            console.error('❌ Groq API Connection Test Failed:', error.message);
            return NextResponse.json(
                {
                    error: 'Groq API connection failed',
                    details: error.message,
                    suggestion: 'Check your API key in .env.local'
                },
                { status: 500 }
            );
        }


        const result = await groq.json(
            COURSE_CONFIG_PROMPT,
            userInput,
            {
                model: 'openai/gpt-oss-120b',
                temperature: 0.7,
                max_tokens: 4000
            }
        );

        console.log('✅ Groq API Response Received:', {
            resultType: typeof result,
            isArray: Array.isArray(result),
            length: Array.isArray(result) ? result.length : 'N/A'
        });

        if (Array.isArray(result)) {
            console.log('📊 First slide preview:', JSON.stringify(result[0], null, 2));
        }
        const courseResult = await db.insert(coursesTable).values({
            courseId: courseId,
            courseName: result.courseName,
            userInput: userInput,
            type: type,
            courseLayout: result,
            userId: user?.primaryEmailAddress?.emailAddress
        }).returning();


        // Return the result
        return NextResponse.json({
            success: true,
            data: courseResult[0],
            metadata: {
                generatedAt: new Date().toISOString(),
                model: 'openai/gpt-oss-120b',
                courseId,
                type
            }
        });

    } catch (error: any) {
        console.error('🔥 Course Layout Generation Failed:', {
            error: error.message,
            stack: error.stack,
            name: error.name
        });


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