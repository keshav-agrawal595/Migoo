import { db } from "@/config/db";
import { groq } from "@/config/groq";
import { chapterContentSlides } from "@/config/schema";
import { GENERATE_VIDEO_PROMPT } from "@/data/Prompt";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { chapter, courseId } = await req.json();

        console.log('🎬 Starting video content generation for:', {
            courseId,
            chapterId: chapter.chapterId,
            chapterTitle: chapter.chapterTitle
        });

        // Generate video slides using Groq AI
        const result = await groq.json(
            GENERATE_VIDEO_PROMPT,
            JSON.stringify(chapter),
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

        if (!Array.isArray(result)) {
            throw new Error('Groq API did not return an array of slides');
        }

        if (result.length > 0) {
            console.log('📊 First slide preview:', JSON.stringify(result[0], null, 2));
        }

        const VideoContentJson = result;
        const insertedSlides = [];

        // Process each slide: generate audio, upload to Vercel Blob, and save to database
        for (let i = 0; i < VideoContentJson.length; i++) {
            const slide = VideoContentJson[i];
            const narration = slide.narration.fullText;

            console.log(`🎤 Generating audio for slide ${i + 1}/${VideoContentJson.length}: ${slide.slideId}`);
            console.log(`📝 Narration text (${narration.length} chars):`, narration.substring(0, 100) + '...');

            try {
                // Generate audio using Groq Orpheus TTS API
                const response = await fetch("https://api.groq.com/openai/v1/audio/speech", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "canopylabs/orpheus-v1-english",
                        voice: "troy",
                        input: narration,
                        response_format: "wav"
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`❌ Groq TTS API Error (${response.status}):`, errorText);
                    throw new Error(`Groq TTS failed: ${response.status} - ${errorText}`);
                }

                console.log('✅ Groq TTS Response received');

                // Get audio buffer from response
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = Buffer.from(arrayBuffer);
                console.log(`📦 Audio buffer size: ${audioBuffer.length} bytes`);

                // Validate audio buffer size
                if (audioBuffer.length < 1000) {
                    console.error('⚠️ Suspiciously small audio buffer!');
                    throw new Error(`Audio buffer too small (${audioBuffer.length} bytes). Expected larger WAV file.`);
                }

                // Upload audio to Vercel Blob
                const filename = `audio/${courseId}/${chapter.chapterId}/${slide.slideId}.wav`;
                const { url } = await put(filename, audioBuffer, {
                    access: 'public',
                    contentType: 'audio/wav',
                    allowOverwrite: true
                });

                console.log(`✅ Audio uploaded to Vercel Blob: ${url}`);

                // Insert slide data into database
                const [insertedSlide] = await db.insert(chapterContentSlides).values({
                    courseId: courseId,
                    chapterId: chapter.chapterId,
                    slideId: slide.slideId,
                    slideIndex: slide.slideIndex,
                    audioUrl: url,
                    narration: slide.narration,
                    html: slide.html,
                    revealData: slide.revealData
                }).returning();

                insertedSlides.push(insertedSlide);
                console.log(`💾 Slide ${slide.slideId} saved to database with audio URL`);

            } catch (error: any) {
                console.error(`❌ Error processing slide ${slide.slideId}:`, error.message);
                throw new Error(`Failed to process slide ${slide.slideId}: ${error.message}`);
            }
        }

        console.log('🎉 Video content generation completed successfully!');

        return NextResponse.json({
            success: true,
            data: insertedSlides,
            metadata: {
                generatedAt: new Date().toISOString(),
                model: 'openai/gpt-oss-120b',
                courseId,
                chapterId: chapter.chapterId,
                totalSlides: insertedSlides.length
            }
        });

    } catch (error: any) {
        console.error('🔥 Video content generation failed:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to generate video content',
                details: error.stack
            },
            { status: 500 }
        );
    }
}