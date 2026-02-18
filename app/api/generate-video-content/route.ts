import { db } from "@/config/db";
import { openrouter } from "@/config/openrouter";
import { sarvam } from "@/config/sarvam";
import { chapterContentSlides, courseImages } from "@/config/schema";
import { GENERATE_VIDEO_PROMPT } from "@/data/Prompt";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════════
// 🧪 TESTING MODE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
const TESTING_MODE = true;  // ⚠️ SET TO false TO GENERATE ALL CHAPTERS
const TEST_CHAPTER_INDEX = 0;  // Generate only this chapter (0 = first chapter)

console.log('🧪 TESTING MODE:', TESTING_MODE ? 'ENABLED (Single Chapter Only)' : 'DISABLED (All Chapters)');
if (TESTING_MODE) {
    console.log(`📌 Will only generate chapter at index: ${TEST_CHAPTER_INDEX}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO UTILITIES: WAV Merging
// ═══════════════════════════════════════════════════════════════════════════════

interface WavHeader {
    sampleRate: number;
    numChannels: number;
    bitsPerSample: number;
}

function parseWavHeader(buffer: Buffer): WavHeader | null {
    if (buffer.length < 44) return null;

    const sampleRate = buffer.readUInt32LE(24);
    const numChannels = buffer.readUInt16LE(22);
    const bitsPerSample = buffer.readUInt16LE(34);

    return { sampleRate, numChannels, bitsPerSample };
}

function mergeWavFiles(audioBuffers: Buffer[]): Buffer {
    console.log(`🔗 Merging ${audioBuffers.length} WAV files...`);

    if (audioBuffers.length === 0) throw new Error('No audio buffers to merge');
    if (audioBuffers.length === 1) return audioBuffers[0];

    const audioDataChunks: Buffer[] = [];
    let totalDataSize = 0;

    const firstHeader = parseWavHeader(audioBuffers[0]);
    if (!firstHeader) throw new Error('Invalid WAV header in first chunk');

    for (let i = 0; i < audioBuffers.length; i++) {
        const audioData = audioBuffers[i].slice(44);
        audioDataChunks.push(audioData);
        totalDataSize += audioData.length;
    }

    const mergedData = Buffer.concat(audioDataChunks);

    const newHeader = Buffer.alloc(44);
    newHeader.write('RIFF', 0);
    newHeader.writeUInt32LE(mergedData.length + 36, 4);
    newHeader.write('WAVE', 8);
    newHeader.write('fmt ', 12);
    newHeader.writeUInt32LE(16, 16);
    newHeader.writeUInt16LE(1, 20);
    newHeader.writeUInt16LE(firstHeader.numChannels, 22);
    newHeader.writeUInt32LE(firstHeader.sampleRate, 24);
    newHeader.writeUInt32LE(firstHeader.sampleRate * firstHeader.numChannels * (firstHeader.bitsPerSample / 8), 28);
    newHeader.writeUInt16LE(firstHeader.numChannels * (firstHeader.bitsPerSample / 8), 32);
    newHeader.writeUInt16LE(firstHeader.bitsPerSample, 34);
    newHeader.write('data', 36);
    newHeader.writeUInt32LE(mergedData.length, 40);

    const mergedBuffer = Buffer.concat([newHeader, mergedData]);

    console.log(`✅ Merged successfully: ${audioBuffers.length} chunks → ${mergedBuffer.length} bytes`);
    return mergedBuffer;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TTS: Sarvam AI with Smart Chunking
// ═══════════════════════════════════════════════════════════════════════════════

function chunkTextForTTS(text: string, maxLength: number = 2400): string[] {
    console.log(`✂️ Chunking text: ${text.length} characters`);

    if (text.length <= maxLength) {
        console.log(`✅ No chunking needed (text is ${text.length} chars)`);
        return [text];
    }

    const chunks: string[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';

    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;

        if (currentChunk.length + trimmed.length + 1 > maxLength) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = trimmed;
        } else {
            currentChunk += (currentChunk ? ' ' : '') + trimmed;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    console.log(`✅ Split into ${chunks.length} chunks:`, chunks.map(c => c.length));
    return chunks;
}

async function generateAudioWithSarvam(text: string): Promise<Buffer> {
    if (text.length > 2500) {
        throw new Error(`Text too long for Sarvam AI: ${text.length} chars (max 2500)`);
    }

    console.log(`🎤 Generating audio: ${text.length} chars`);

    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
        method: 'POST',
        headers: {
            'api-subscription-key': process.env.SARVAM_API_KEY!,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: text,
            target_language_code: "en-IN",
            speaker: "kabir",
            pace: 1.05,
            speech_sample_rate: 22050,
            enable_preprocessing: true,
            model: "bulbul:v3",
            temperature: 0.6,
            output_audio_codec: "wav"
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sarvam TTS failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    if (!result.audios || result.audios.length === 0) {
        throw new Error('No audio data from Sarvam AI');
    }

    const audioBuffer = Buffer.from(result.audios[0], 'base64');
    console.log(`✅ Audio generated: ${audioBuffer.length} bytes`);

    return audioBuffer;
}

async function generateAudioForLongText(text: string): Promise<Buffer> {
    console.log(`🎵 Processing long text: ${text.length} chars`);

    const chunks = chunkTextForTTS(text, 2400);

    if (chunks.length === 1) {
        return await generateAudioWithSarvam(chunks[0]);
    }

    console.log(`🔄 Generating ${chunks.length} audio chunks...`);
    const audioBuffers: Buffer[] = [];

    for (let i = 0; i < chunks.length; i++) {
        console.log(`🔊 Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);

        try {
            const audioBuffer = await generateAudioWithSarvam(chunks[i]);
            audioBuffers.push(audioBuffer);
            console.log(`✅ Chunk ${i + 1} generated: ${audioBuffer.length} bytes`);
        } catch (error: any) {
            console.error(`❌ Chunk ${i + 1} failed:`, error.message);
            throw new Error(`Audio generation failed at chunk ${i + 1}: ${error.message}`);
        }

        if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    console.log(`🔗 Merging ${audioBuffers.length} audio chunks...`);
    const mergedBuffer = mergeWavFiles(audioBuffers);
    console.log(`✅ Final audio: ${mergedBuffer.length} bytes`);

    return mergedBuffer;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPEECH-TO-TEXT: Sarvam AI Transcription (Replaces ElevenLabs)
// ═══════════════════════════════════════════════════════════════════════════════

interface Word {
    text: string;
    start: number;
    end: number;
}

interface Chunk {
    timestamp: [number, number];
    text: string;
    wordCount: number;
}

/**
 * Generate precise short sentence chunks from word-level timestamps
 * Optimized for better caption sync with narration
 */
function wordsToShortSentenceChunks(words: Word[]): Chunk[] {
    if (!words || words.length === 0) {
        console.warn('⚠️ No words for chunking');
        return [];
    }

    const totalWords = words.length;

    // Target 2-5 words per chunk for short, readable captions
    const minWordsPerChunk = 2;
    const maxWordsPerChunk = 5;
    const targetWordsPerChunk = 3; // Ideal for short sentences

    console.log(`🎯 Chunking: ${totalWords} words into short sentence chunks (${targetWordsPerChunk} words/chunk)`);

    const chunks: Chunk[] = [];
    let currentChunkWords: Word[] = [];
    let chunkStartTime = words[0].start;

    const sentenceEnders = ['.', '!', '?'];
    const clauseBreakers = [',', ';', ':', '--'];
    const shortPauseThreshold = 0.3; // 300ms pause
    const longPauseThreshold = 0.6;  // 600ms pause

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        currentChunkWords.push(word);

        const currentLength = currentChunkWords.length;
        const isLastWord = i === words.length - 1;
        const nextWord = i < words.length - 1 ? words[i + 1] : null;

        const hasSentenceEnder = sentenceEnders.some(e => word.text.endsWith(e));
        const hasClauseBreaker = clauseBreakers.some(b => word.text.endsWith(b));
        const timeTillNext = nextWord ? nextWord.start - word.end : 0;
        const hasShortPause = timeTillNext > shortPauseThreshold;
        const hasLongPause = timeTillNext > longPauseThreshold;

        const isMinLength = currentLength >= minWordsPerChunk;
        const isTargetLength = currentLength >= targetWordsPerChunk;
        const isMaxLength = currentLength >= maxWordsPerChunk;

        // Chunking logic: Prioritize short, natural phrases
        const shouldChunk = isLastWord || (
            isMinLength && (
                // Natural sentence boundaries
                (hasSentenceEnder && (hasShortPause || isTargetLength)) ||
                // Clause breaks at target length
                (hasClauseBreaker && isTargetLength && hasShortPause) ||
                // Long pauses indicate natural breaks
                (hasLongPause && isTargetLength) ||
                // Force break at max length
                isMaxLength
            )
        );

        if (shouldChunk) {
            const chunkText = currentChunkWords.map(w => w.text).join(' ');

            chunks.push({
                timestamp: [chunkStartTime, word.end],
                text: chunkText,
                wordCount: currentChunkWords.length
            });

            currentChunkWords = [];
            if (i < words.length - 1) {
                chunkStartTime = words[i + 1].start;
            }
        }
    }

    console.log(`✅ Created ${chunks.length} short sentence chunks`);
    console.log(`📊 Chunk stats: min=${Math.min(...chunks.map(c => c.wordCount))} words, max=${Math.max(...chunks.map(c => c.wordCount))} words, avg=${(totalWords / chunks.length).toFixed(1)} words`);

    return chunks;
}

/**
 * Generate captions using Sarvam AI Speech-to-Text
 */
async function generateCaptions(audioUrl: string): Promise<any> {
    try {
        console.log('🎯 Generating captions with Sarvam AI...');

        // Use Sarvam AI for transcription
        const transcription = await sarvam.transcribeAudio(audioUrl);

        console.log(`✅ Transcription received: ${transcription.words.length} words`);
        console.log(`📝 Full text: ${transcription.text.substring(0, 100)}...`);

        // Generate short sentence chunks for better caption readability
        const chunks = wordsToShortSentenceChunks(transcription.words);

        const captions = {
            text: transcription.text,
            language_code: transcription.languageCode,
            chunks: chunks.map(c => ({
                timestamp: c.timestamp,
                text: c.text,
                wordCount: c.wordCount
            })),
            metadata: {
                totalWords: transcription.words.length,
                totalChunks: chunks.length,
                avgWordsPerChunk: (transcription.words.length / chunks.length).toFixed(1),
                duration: transcription.words.length > 0 ?
                    (transcription.words[transcription.words.length - 1].end - transcription.words[0].start).toFixed(2) : 0,
                engine: 'sarvam-ai-saaras-v3'
            }
        };

        console.log(`✅ Captions: ${captions.chunks.length} chunks (avg ${captions.metadata.avgWordsPerChunk} words/chunk)`);

        // Log first few chunks for verification
        console.log('📄 First 3 chunks:');
        captions.chunks.slice(0, 3).forEach((chunk, i) => {
            console.log(`  ${i + 1}. [${chunk.timestamp[0].toFixed(2)}s-${chunk.timestamp[1].toFixed(2)}s] "${chunk.text}"`);
        });

        return captions;

    } catch (error: any) {
        console.error('❌ Caption generation failed:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN API ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
    try {
        const { chapter, courseId, courseName, chapterIndex } = await req.json();

        console.log('\n' + '═'.repeat(80));
        console.log('🎬 VIDEO CONTENT GENERATION');
        console.log('═'.repeat(80));
        console.log('Course:', courseId);
        console.log('Chapter:', chapter.chapterTitle);
        console.log('Index:', chapterIndex);
        console.log('═'.repeat(80) + '\n');

        // Testing Mode Check
        if (TESTING_MODE && chapterIndex !== TEST_CHAPTER_INDEX) {
            console.log(`⏭️ Skipping chapter ${chapterIndex} (testing mode)`);
            return NextResponse.json({
                success: true,
                skipped: true,
                reason: `Testing mode: only processing chapter ${TEST_CHAPTER_INDEX}`
            });
        }

        // Check Existing Slides
        const existingSlides = await db
            .select()
            .from(chapterContentSlides)
            .where(eq(chapterContentSlides.chapterId, chapter.chapterId));

        if (existingSlides.length > 0) {
            console.log(`✅ Slides already exist (${existingSlides.length})`);
            return NextResponse.json({
                success: true,
                data: existingSlides,
                skipped: true,
                message: 'Slides already exist for this chapter'
            });
        }

        // Test OpenRouter Connection
        console.log('🔗 Testing OpenRouter API...');
        try {
            await openrouter.test();
            console.log('✅ OpenRouter connected');
        } catch (error: any) {
            console.error('❌ OpenRouter connection failed:', error.message);
            return NextResponse.json(
                {
                    success: false,
                    error: 'OpenRouter API connection failed',
                    details: error.message
                },
                { status: 500 }
            );
        }

        // Generate Slides with OpenRouter
        console.log('🤖 Generating slides with OpenRouter...');
        console.log('📝 Chapter content length:', JSON.stringify(chapter).length, 'chars');

        let slidesData;
        let usedModel = 'unknown';
        try {
            let result;
            const fallbackModels = [
                'arcee-ai/trinity-large-preview:free',
                'google/gemini-2.5-flash-preview-05-20',
                'meta-llama/llama-4-maverick:free'
            ];

            let lastError: any = null;
            for (const model of fallbackModels) {
                try {
                    console.log(`🎯 Attempting with ${model}...`);
                    result = await openrouter.json(
                        GENERATE_VIDEO_PROMPT,
                        JSON.stringify(chapter),
                        {
                            model: model,
                            temperature: 0.7,
                            maxTokens: 16000
                        }
                    );
                    usedModel = model;
                    break;
                } catch (modelError: any) {
                    console.warn(`⚠️ ${model} failed: ${modelError.message}`);
                    lastError = modelError;
                }
            }

            if (!result) {
                throw lastError || new Error('All models failed');
            }

            console.log('✅ OpenRouter response received');
            console.log('📊 Response type:', typeof result);
            console.log('📊 Response keys:', Object.keys(result || {}));

            // Handle response format
            if (Array.isArray(result)) {
                slidesData = result;
            } else if (result?.slides && Array.isArray(result.slides)) {
                slidesData = result.slides;
            } else if (result?.data && Array.isArray(result.data)) {
                slidesData = result.data;
            } else if (typeof result === 'object' && result !== null) {
                const arrays = Object.values(result).filter(v => Array.isArray(v));
                if (arrays.length > 0) {
                    slidesData = arrays[0];
                } else {
                    slidesData = [result];
                }
            } else {
                console.error('❌ Unexpected response format:', result);
                throw new Error('Invalid response format from OpenRouter');
            }

            console.log(`📊 Processing ${slidesData.length} slides`);

            // Fetch pre-generated DeAPI images for this course
            console.log('🖼️  Fetching pre-generated DeAPI images...');
            const allImages = await db
                .select()
                .from(courseImages)
                .where(eq(courseImages.courseId, courseId));

            // Sort by imageIndex for consistent ordering
            allImages.sort((a, b) => a.imageIndex - b.imageIndex);

            console.log(`🖼️  Found ${allImages.length} total images for course`);

            // Replace {{IMAGE_PLACEHOLDER}} in each slide's HTML with UNIQUE image URLs
            if (allImages.length > 0) {
                // Use chapterIndex offset so different chapters use different images
                const chapterOffset = chapterIndex * slidesData.length;

                for (let idx = 0; idx < slidesData.length; idx++) {
                    if (slidesData[idx].html) {
                        // Count how many {{IMAGE_PLACEHOLDER}} are in this slide
                        const placeholderCount = (slidesData[idx].html.match(/\{\{IMAGE_PLACEHOLDER\}\}/g) || []).length;

                        if (placeholderCount > 0) {
                            // Replace each placeholder with a unique image
                            let placeholderIndex = 0;
                            slidesData[idx].html = slidesData[idx].html.replace(
                                /\{\{IMAGE_PLACEHOLDER\}\}/g,
                                () => {
                                    // Unique image per slide: chapter offset + slide index + placeholder index
                                    const imgOffset = (chapterOffset + idx + placeholderIndex) % allImages.length;
                                    const imageUrl = allImages[imgOffset].imageUrl;
                                    placeholderIndex++;
                                    return imageUrl;
                                }
                            );
                            console.log(`🖼️  Slide ${idx + 1}: Injected ${placeholderCount} unique DeAPI image(s)`);
                        }
                    }
                }
            } else {
                console.warn('⚠️ No DeAPI images found — {{IMAGE_PLACEHOLDER}} will remain in HTML');
            }

        } catch (error: any) {
            console.error('❌ OpenRouter generation failed:', error.message);
            console.error('Stack trace:', error.stack);
            return NextResponse.json(
                {
                    success: false,
                    error: 'Failed to generate slides',
                    details: error.message,
                    suggestion: 'Check the console logs for detailed error information'
                },
                { status: 500 }
            );
        }

        if (!slidesData || slidesData.length === 0) {
            throw new Error('No slides generated');
        }

        // Process Each Slide
        const insertedSlides = [];

        for (let i = 0; i < slidesData.length; i++) {
            const slide = slidesData[i];

            console.log(`\n${'─'.repeat(80)}`);
            console.log(`🎬 Slide ${i + 1}/${slidesData.length}: ${slide.slideId || `slide-${i}`}`);
            console.log(`${'─'.repeat(80)}`);

            // Validate slide
            if (!slide.narration?.fullText) {
                console.warn(`⚠️ Missing narration, skipping...`);
                continue;
            }

            const narration = slide.narration.fullText;
            const wordCount = narration.split(/\s+/).length;
            const estimatedMinutes = Math.ceil(wordCount / 180);

            console.log(`📝 Narration: ${narration.length} chars, ${wordCount} words (~${estimatedMinutes} min)`);

            try {
                // Step 1: Generate Audio (with chunking)
                console.log('🔊 Step 1: Generating audio...');
                const audioBuffer = await generateAudioForLongText(narration);
                console.log(`✅ Audio generated: ${audioBuffer.length} bytes`);

                // Step 2: Upload to Vercel Blob
                console.log('☁️ Step 2: Uploading to Vercel Blob...');
                const filename = `audio/${courseId}/${chapter.chapterId}/${slide.slideId || `slide-${i}`}.wav`;
                const { url } = await put(filename, audioBuffer, {
                    access: 'public',
                    contentType: 'audio/wav',
                    allowOverwrite: true
                });
                console.log(`✅ Uploaded: ${url}`);

                // Step 3: Generate Captions with Sarvam AI (Replaces ElevenLabs)
                console.log('🎬 Step 3: Generating captions with Sarvam AI...');
                const captions = await generateCaptions(url);
                console.log(`✅ Captions: ${captions.chunks.length} chunks`);

                // Step 4: Save to Database
                console.log('💾 Step 4: Saving to database...');
                const [insertedSlide] = await db.insert(chapterContentSlides).values({
                    courseId: courseId,
                    chapterId: chapter.chapterId,
                    slideId: slide.slideId || `slide-${i}`,
                    slideIndex: slide.slideIndex || i,
                    audioUrl: url,
                    narration: slide.narration,
                    captions: captions,
                    html: slide.html,
                    revealData: slide.revealData || []
                }).returning();

                insertedSlides.push(insertedSlide);
                console.log(`✅ Slide ${i + 1} saved!`);

            } catch (error: any) {
                console.error(`❌ Error processing slide ${i + 1}:`, error.message);
                console.error('Stack:', error.stack);

                // Continue with next slide instead of failing entire batch
                console.log('⏭️ Continuing to next slide...');
                continue;
            }
        }

        // Summary
        console.log('\n' + '═'.repeat(80));
        console.log(`🎉 SUCCESS: Generated ${insertedSlides.length}/${slidesData.length} slides`);
        console.log('═'.repeat(80) + '\n');

        return NextResponse.json({
            success: true,
            data: insertedSlides,
            metadata: {
                generatedAt: new Date().toISOString(),
                model: usedModel,
                ttsEngine: 'sarvam-bulbul-v3',
                sttEngine: 'sarvam-saaras-v3',
                courseId,
                chapterId: chapter.chapterId,
                totalSlides: insertedSlides.length,
                requestedSlides: slidesData.length,
                testingMode: TESTING_MODE
            }
        });

    } catch (error: any) {
        console.error('\n' + '═'.repeat(80));
        console.error('🔥 VIDEO CONTENT GENERATION FAILED');
        console.error('═'.repeat(80));
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('═'.repeat(80) + '\n');

        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to generate video content',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            { status: 500 }
        );
    }
}