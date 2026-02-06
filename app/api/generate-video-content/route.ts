import { db } from "@/config/db";
import { groq } from "@/config/groq";
import { chapterContentSlides } from "@/config/schema";
import { GENERATE_VIDEO_PROMPT } from "@/data/Prompt";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ElevenLabs Speech-to-Text Helper Functions
async function submitAudioForTranscription(audioUrl: string): Promise<string> {
    console.log('📤 Submitting audio URL to ElevenLabs for transcription:', audioUrl);

    const formData = new FormData();
    formData.append('model_id', 'scribe_v2');
    formData.append('cloud_storage_url', audioUrl);
    formData.append('language_code', 'en');
    formData.append('split_on_words', 'true');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY!
        },
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ ElevenLabs transcription submission failed (${response.status}):`, errorText);
        throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Transcription submitted successfully. ID:', result.transcription_id);

    return result.transcription_id;
}

async function getTranscriptionResult(transcriptionId: string, maxRetries: number = 30): Promise<any> {
    console.log('🔄 Polling for transcription result:', transcriptionId);

    for (let i = 0; i < maxRetries; i++) {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/speech-to-text/transcripts/${transcriptionId}`,
            {
                headers: {
                    'xi-api-key': process.env.ELEVENLABS_API_KEY!
                }
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Failed to get transcription result (${response.status}):`, errorText);
            throw new Error(`Failed to retrieve transcription: ${response.status}`);
        }

        const result = await response.json();

        // Check if transcription is complete
        if (result.text && result.words) {
            console.log('✅ Transcription completed successfully');
            return result;
        }

        // Wait before next poll (2 seconds)
        console.log(`⏳ Waiting for transcription... Attempt ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Transcription timed out after maximum retries');
}

// Convert word-level timestamps to smaller phrase chunks (3-7 words)
// This creates more granular timing for smoother reveal animations
function wordsToChunks(words: any[]): { timestamp: [number, number] }[] {
    if (!words || words.length === 0) return [];

    const chunks: { timestamp: [number, number] }[] = [];
    let currentChunk: any[] = [];
    let chunkStartTime = words[0].start;

    // Common conjunctions and transition words that indicate natural phrase boundaries
    const phraseBreakers = ['and', 'but', 'or', 'so', 'yet', 'for', 'nor', 'because',
        'although', 'while', 'when', 'where', 'if', 'then'];

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        currentChunk.push(word);

        // Check for natural phrase boundaries
        const isPunctuation = word.text.match(/[.!?;,]$/); // Added comma and semicolon
        const isConjunction = phraseBreakers.includes(word.text.toLowerCase().replace(/[.,!?;]$/, ''));
        const isMaxLength = currentChunk.length >= 7; // Reduced from 10 to 7
        const isMinLengthMet = currentChunk.length >= 3; // Ensure at least 3 words
        const isLastWord = i === words.length - 1;

        // Create chunk on:
        // 1. Sentence endings (.!?)
        // 2. Commas/semicolons (if min length met)
        // 3. After conjunctions (if min length met)
        // 4. Max 7 words
        // 5. Last word
        const shouldCreateChunk =
            isPunctuation ||
            (isConjunction && isMinLengthMet) ||
            isMaxLength ||
            isLastWord;

        if (shouldCreateChunk) {
            const chunkEndTime = word.end;
            chunks.push({
                timestamp: [chunkStartTime, chunkEndTime]
            });

            // Start new chunk
            currentChunk = [];
            if (i < words.length - 1) {
                chunkStartTime = words[i + 1].start;
            }
        }
    }

    console.log(`📊 Created ${chunks.length} chunks from ${words.length} words (avg ${(words.length / chunks.length).toFixed(1)} words/chunk)`);
    return chunks;
}

async function generateCaptions(audioUrl: string): Promise<any> {
    try {
        console.log('🎯 Starting caption generation for audio:', audioUrl);

        // Step 1: Submit audio for transcription
        const transcriptionId = await submitAudioForTranscription(audioUrl);

        // Step 2: Poll for transcription result
        const transcription = await getTranscriptionResult(transcriptionId);

        // Step 3: Convert words to chunks for reveal timing
        const chunks = wordsToChunks(transcription.words);

        // Step 4: Format captions data with chunks
        const captions = {
            text: transcription.text,
            language_code: transcription.language_code,
            chunks: chunks  // This is what the frontend expects
        };

        console.log(`✅ Captions generated: ${chunks.length} chunks from ${transcription.words.length} words`);
        return captions;

    } catch (error: any) {
        console.error('❌ Caption generation failed:', error.message);
        throw error;
    }
}

export async function POST(req: NextRequest) {
    try {
        const { chapter, courseId } = await req.json();

        console.log('🎬 Starting video content generation for:', {
            courseId,
            chapterId: chapter.chapterId,
            chapterTitle: chapter.chapterTitle
        });

        // Check if slides already exist for this chapter
        const existingSlides = await db
            .select()
            .from(chapterContentSlides)
            .where(eq(chapterContentSlides.chapterId, chapter.chapterId));

        if (existingSlides.length > 0) {
            console.log(`✅ Slides already exist for chapter ${chapter.chapterId}. Skipping generation.`);
            console.log(`📊 Found ${existingSlides.length} existing slides`);

            return NextResponse.json({
                success: true,
                data: existingSlides,
                skipped: true,
                message: 'Slides already exist for this chapter',
                metadata: {
                    generatedAt: existingSlides[0].createdAt,
                    courseId,
                    chapterId: chapter.chapterId,
                    totalSlides: existingSlides.length
                }
            });
        }

        // Generate video slides using Groq AI (using most capable model for detailed content)
        const result = await groq.json(
            GENERATE_VIDEO_PROMPT,
            JSON.stringify(chapter),
            {
                model: 'llama-3.3-70b-versatile',  // Most capable Groq model
                temperature: 0.8,  // Slightly higher for more creative, detailed content
                max_tokens: 12000  // Much higher for detailed paragraphs and long narration
            }
        );

        console.log('✅ Groq API Response Received:', {
            resultType: typeof result,
            isArray: Array.isArray(result),
            length: Array.isArray(result) ? result.length : 'N/A'
        });

        // Handle case where AI returns single object instead of array
        let VideoContentJson;
        if (!Array.isArray(result)) {
            console.log('⚠️ AI returned single object instead of array. Wrapping in array...');
            VideoContentJson = [result];
        } else {
            VideoContentJson = result;
        }

        if (VideoContentJson.length > 0) {
            console.log('📊 First slide preview:', JSON.stringify(VideoContentJson[0], null, 2));
        }

        const insertedSlides = [];

        // Process each slide: generate audio, upload to Vercel Blob, and save to database
        for (let i = 0; i < VideoContentJson.length; i++) {
            const slide = VideoContentJson[i];
            const narration = slide.narration.fullText;

            console.log(`🎤 Generating audio for slide ${i + 1}/${VideoContentJson.length}: ${slide.slideId}`);
            console.log(`📝 Narration text (${narration.length} chars):`, narration.substring(0, 100) + '...');
            // try {
            //     // Generate audio using ElevenLabs TTS API
            //     const voiceId = "JBFqnCBsd6RMkjVDRZzb"; // You can change this to use different voices
            //     const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
            //         method: "POST",
            //         headers: {
            //             "xi-api-key": process.env.ELEVENLABS_API_KEY!,
            //             "Content-Type": "application/json"
            //         },
            //         body: JSON.stringify({
            //             text: narration,
            //             model_id: "eleven_multilingual_v2",
            //             voice_settings: {
            //                 stability: 0.5,
            //                 similarity_boost: 0.75,
            //                 style: 0,
            //                 use_speaker_boost: true
            //             }
            //         })
            //     });

            //     if (!response.ok) {
            //         const errorText = await response.text();
            //         console.error(`❌ ElevenLabs TTS API Error (${response.status}):`, errorText);
            //         throw new Error(`ElevenLabs TTS failed: ${response.status} - ${errorText}`);
            //     }

            //     console.log('✅ ElevenLabs TTS Response received');

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

                // Generate captions from audio using ElevenLabs (with chunks)
                console.log('🎬 Generating captions from audio...');
                const captions = await generateCaptions(url);

                // Insert slide data into database with captions
                const [insertedSlide] = await db.insert(chapterContentSlides).values({
                    courseId: courseId,
                    chapterId: chapter.chapterId,
                    slideId: slide.slideId,
                    slideIndex: slide.slideIndex,
                    audioUrl: url,
                    narration: slide.narration,
                    captions: captions,  // Now contains chunks instead of words
                    html: slide.html,
                    revealData: slide.revealData
                }).returning();

                insertedSlides.push(insertedSlide);
                console.log(`💾 Slide ${slide.slideId} saved to database with audio URL and captions`);

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