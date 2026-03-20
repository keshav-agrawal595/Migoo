// import { db } from "@/config/db";
// import { gemini } from "@/config/gemini";
// import { chapterContentSlides } from "@/config/schema";
// import { GENERATE_VIDEO_PROMPT } from "@/data/Prompt";
// import { put } from "@vercel/blob";
// import { eq } from "drizzle-orm";
// import { NextRequest, NextResponse } from "next/server";

// // ═══════════════════════════════════════════════════════════════════════════════
// // 🧪 TESTING MODE CONFIGURATION
// // ═══════════════════════════════════════════════════════════════════════════════
// const TESTING_MODE = true;  // ⚠️ SET TO false TO GENERATE ALL CHAPTERS
// const TEST_CHAPTER_INDEX = 0;  // Generate only this chapter (0 = first chapter)

// console.log('🧪 TESTING MODE:', TESTING_MODE ? 'ENABLED (Single Chapter Only)' : 'DISABLED (All Chapters)');
// if (TESTING_MODE) {
//     console.log(`📌 Will only generate chapter at index: ${TEST_CHAPTER_INDEX}`);
// }

// // ═══════════════════════════════════════════════════════════════════════════════
// // AUDIO UTILITIES: WAV Merging
// // ═══════════════════════════════════════════════════════════════════════════════

// interface WavHeader {
//     sampleRate: number;
//     numChannels: number;
//     bitsPerSample: number;
// }

// function parseWavHeader(buffer: Buffer): WavHeader | null {
//     if (buffer.length < 44) return null;

//     const sampleRate = buffer.readUInt32LE(24);
//     const numChannels = buffer.readUInt16LE(22);
//     const bitsPerSample = buffer.readUInt16LE(34);

//     return { sampleRate, numChannels, bitsPerSample };
// }

// function mergeWavFiles(audioBuffers: Buffer[]): Buffer {
//     console.log(`🔗 Merging ${audioBuffers.length} WAV files...`);

//     if (audioBuffers.length === 0) throw new Error('No audio buffers to merge');
//     if (audioBuffers.length === 1) return audioBuffers[0];

//     // Extract audio data from each chunk (skip 44-byte header)
//     const audioDataChunks: Buffer[] = [];
//     let totalDataSize = 0;

//     const firstHeader = parseWavHeader(audioBuffers[0]);
//     if (!firstHeader) throw new Error('Invalid WAV header in first chunk');

//     for (let i = 0; i < audioBuffers.length; i++) {
//         const audioData = audioBuffers[i].slice(44); // Skip 44-byte WAV header
//         audioDataChunks.push(audioData);
//         totalDataSize += audioData.length;
//     }

//     // Create merged audio data
//     const mergedData = Buffer.concat(audioDataChunks);

//     // Create new WAV header
//     const newHeader = Buffer.alloc(44);
//     newHeader.write('RIFF', 0);
//     newHeader.writeUInt32LE(mergedData.length + 36, 4); // File size - 8
//     newHeader.write('WAVE', 8);
//     newHeader.write('fmt ', 12);
//     newHeader.writeUInt32LE(16, 16); // fmt chunk size
//     newHeader.writeUInt16LE(1, 20); // PCM format
//     newHeader.writeUInt16LE(firstHeader.numChannels, 22);
//     newHeader.writeUInt32LE(firstHeader.sampleRate, 24);
//     newHeader.writeUInt32LE(firstHeader.sampleRate * firstHeader.numChannels * (firstHeader.bitsPerSample / 8), 28); // byte rate
//     newHeader.writeUInt16LE(firstHeader.numChannels * (firstHeader.bitsPerSample / 8), 32); // block align
//     newHeader.writeUInt16LE(firstHeader.bitsPerSample, 34);
//     newHeader.write('data', 36);
//     newHeader.writeUInt32LE(mergedData.length, 40);

//     const mergedBuffer = Buffer.concat([newHeader, mergedData]);

//     console.log(`✅ Merged successfully: ${audioBuffers.length} chunks → ${mergedBuffer.length} bytes`);
//     return mergedBuffer;
// }

// // ═══════════════════════════════════════════════════════════════════════════════
// // TTS: Sarvam AI with Smart Chunking
// // ═══════════════════════════════════════════════════════════════════════════════

// function chunkTextForTTS(text: string, maxLength: number = 2400): string[] {
//     console.log(`✂️ Chunking text: ${text.length} characters`);

//     if (text.length <= maxLength) {
//         console.log(`✅ No chunking needed (text is ${text.length} chars)`);
//         return [text];
//     }

//     const chunks: string[] = [];

//     // Split by sentences first
//     const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
//     let currentChunk = '';

//     for (const sentence of sentences) {
//         const trimmed = sentence.trim();
//         if (!trimmed) continue;

//         // If adding this sentence exceeds limit, save current chunk and start new one
//         if (currentChunk.length + trimmed.length + 1 > maxLength) {
//             if (currentChunk) {
//                 chunks.push(currentChunk.trim());
//             }
//             currentChunk = trimmed;
//         } else {
//             currentChunk += (currentChunk ? ' ' : '') + trimmed;
//         }
//     }

//     // Add remaining chunk
//     if (currentChunk) {
//         chunks.push(currentChunk.trim());
//     }

//     console.log(`✅ Split into ${chunks.length} chunks:`, chunks.map(c => c.length));
//     return chunks;
// }

// async function generateAudioWithSarvam(text: string): Promise<Buffer> {
//     if (text.length > 2500) {
//         throw new Error(`Text too long for Sarvam AI: ${text.length} chars (max 2500)`);
//     }

//     console.log(`🎤 Generating audio: ${text.length} chars`);

//     const response = await fetch('https://api.sarvam.ai/text-to-speech', {
//         method: 'POST',
//         headers: {
//             'api-subscription-key': process.env.SARVAM_API_KEY!,
//             'Content-Type': 'application/json'
//         },
//         body: JSON.stringify({
//             text: text,
//             target_language_code: "en-IN",
//             speaker: "kabir",
//             pace: 1.05,
//             speech_sample_rate: 22050,
//             enable_preprocessing: true,
//             model: "bulbul:v3",
//             temperature: 0.6,
//             output_audio_codec: "wav"
//         })
//     });

//     if (!response.ok) {
//         const errorText = await response.text();
//         throw new Error(`Sarvam TTS failed (${response.status}): ${errorText}`);
//     }

//     const result = await response.json();

//     if (!result.audios || result.audios.length === 0) {
//         throw new Error('No audio data from Sarvam AI');
//     }

//     const audioBuffer = Buffer.from(result.audios[0], 'base64');
//     console.log(`✅ Audio generated: ${audioBuffer.length} bytes`);

//     return audioBuffer;
// }

// async function generateAudioForLongText(text: string): Promise<Buffer> {
//     console.log(`🎵 Processing long text: ${text.length} chars`);

//     const chunks = chunkTextForTTS(text, 2400);

//     if (chunks.length === 1) {
//         return await generateAudioWithSarvam(chunks[0]);
//     }

//     console.log(`🔄 Generating ${chunks.length} audio chunks...`);
//     const audioBuffers: Buffer[] = [];

//     for (let i = 0; i < chunks.length; i++) {
//         console.log(`🔊 Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);

//         try {
//             const audioBuffer = await generateAudioWithSarvam(chunks[i]);
//             audioBuffers.push(audioBuffer);
//             console.log(`✅ Chunk ${i + 1} generated: ${audioBuffer.length} bytes`);
//         } catch (error: any) {
//             console.error(`❌ Chunk ${i + 1} failed:`, error.message);
//             throw new Error(`Audio generation failed at chunk ${i + 1}: ${error.message}`);
//         }

//         // Small delay between chunks to avoid rate limiting
//         if (i < chunks.length - 1) {
//             await new Promise(resolve => setTimeout(resolve, 500));
//         }
//     }

//     console.log(`🔗 Merging ${audioBuffers.length} audio chunks...`);
//     const mergedBuffer = mergeWavFiles(audioBuffers);
//     console.log(`✅ Final audio: ${mergedBuffer.length} bytes`);

//     return mergedBuffer;
// }

// // ═══════════════════════════════════════════════════════════════════════════════
// // SPEECH-TO-TEXT: ElevenLabs Transcription
// // ═══════════════════════════════════════════════════════════════════════════════

// async function submitAudioForTranscription(audioUrl: string): Promise<string> {
//     console.log('📤 Submitting to ElevenLabs:', audioUrl);

//     const formData = new FormData();
//     formData.append('model_id', 'scribe_v2');
//     formData.append('cloud_storage_url', audioUrl);
//     formData.append('language_code', 'en');
//     formData.append('split_on_words', 'true');

//     const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
//         method: 'POST',
//         headers: {
//             'xi-api-key': process.env.ELEVENLABS_API_KEY!
//         },
//         body: formData
//     });

//     if (!response.ok) {
//         const errorText = await response.text();
//         throw new Error(`ElevenLabs failed (${response.status}): ${errorText}`);
//     }

//     const result = await response.json();
//     console.log('✅ Transcription ID:', result.transcription_id);

//     return result.transcription_id;
// }

// async function getTranscriptionResult(transcriptionId: string, maxRetries: number = 60): Promise<any> {
//     console.log('🔄 Polling for transcription...');

//     for (let i = 0; i < maxRetries; i++) {
//         const response = await fetch(
//             `https://api.elevenlabs.io/v1/speech-to-text/transcripts/${transcriptionId}`,
//             {
//                 headers: {
//                     'xi-api-key': process.env.ELEVENLABS_API_KEY!
//                 }
//             }
//         );

//         if (!response.ok) {
//             throw new Error(`Transcription poll failed: ${response.status}`);
//         }

//         const result = await response.json();

//         if (result.text && result.words) {
//             console.log(`✅ Transcription complete: ${result.words.length} words`);
//             return result;
//         }

//         console.log(`⏳ Attempt ${i + 1}/${maxRetries}...`);
//         await new Promise(resolve => setTimeout(resolve, 3000));
//     }

//     throw new Error('Transcription timeout');
// }

// // ═══════════════════════════════════════════════════════════════════════════════
// // ADVANCED CHUNKING ALGORITHM
// // ═══════════════════════════════════════════════════════════════════════════════

// interface Word {
//     text: string;
//     start: number;
//     end: number;
// }

// interface Chunk {
//     timestamp: [number, number];
//     text: string;
//     wordCount: number;
// }

// function wordsToAdvancedChunks(words: Word[]): Chunk[] {
//     if (!words || words.length === 0) {
//         console.warn('⚠️ No words for chunking');
//         return [];
//     }

//     const totalWords = words.length;
//     const targetChunks = Math.min(Math.max(Math.floor(totalWords / 3), 15), 30);
//     const avgWordsPerChunk = Math.floor(totalWords / targetChunks);

//     console.log(`🎯 Chunking: ${totalWords} words → ${targetChunks} chunks`);

//     const chunks: Chunk[] = [];
//     let currentChunkWords: Word[] = [];
//     let chunkStartTime = words[0].start;

//     const sentenceEnders = ['.', '!', '?'];
//     const clauseBreakers = [',', ';', ':', '--'];

//     for (let i = 0; i < words.length; i++) {
//         const word = words[i];
//         currentChunkWords.push(word);

//         const currentLength = currentChunkWords.length;
//         const isLastWord = i === words.length - 1;
//         const nextWord = i < words.length - 1 ? words[i + 1] : null;

//         const hasSentenceEnder = sentenceEnders.some(e => word.text.endsWith(e));
//         const hasClauseBreaker = clauseBreakers.some(b => word.text.endsWith(b));
//         const timeTillNext = nextWord ? nextWord.start - word.end : 0;
//         const hasLongPause = timeTillNext > 0.5;

//         const isOptimal = currentLength >= avgWordsPerChunk - 1 && currentLength <= avgWordsPerChunk + 2;
//         const isMaxExceeded = currentLength >= avgWordsPerChunk * 1.5;

//         const shouldChunk = isLastWord || (
//             currentLength >= 2 && (
//                 (hasSentenceEnder && (isOptimal || hasLongPause)) ||
//                 (hasLongPause && isOptimal) ||
//                 isMaxExceeded ||
//                 (hasClauseBreaker && currentLength >= avgWordsPerChunk)
//             )
//         );

//         if (shouldChunk) {
//             chunks.push({
//                 timestamp: [chunkStartTime, word.end],
//                 text: currentChunkWords.map(w => w.text).join(' '),
//                 wordCount: currentChunkWords.length
//             });

//             currentChunkWords = [];
//             if (i < words.length - 1) {
//                 chunkStartTime = words[i + 1].start;
//             }
//         }
//     }

//     console.log(`✅ Created ${chunks.length} chunks`);
//     return chunks;
// }

// async function generateCaptions(audioUrl: string): Promise<any> {
//     try {
//         console.log('🎯 Generating captions...');

//         const transcriptionId = await submitAudioForTranscription(audioUrl);
//         const transcription = await getTranscriptionResult(transcriptionId);
//         const chunks = wordsToAdvancedChunks(transcription.words);

//         const captions = {
//             text: transcription.text,
//             language_code: transcription.language_code,
//             chunks: chunks.map(c => ({
//                 timestamp: c.timestamp,
//                 text: c.text,
//                 wordCount: c.wordCount
//             })),
//             metadata: {
//                 totalWords: transcription.words.length,
//                 totalChunks: chunks.length,
//                 avgWordsPerChunk: (transcription.words.length / chunks.length).toFixed(1),
//                 duration: transcription.words.length > 0 ?
//                     (transcription.words[transcription.words.length - 1].end - transcription.words[0].start).toFixed(2) : 0
//             }
//         };

//         console.log(`✅ Captions: ${captions.chunks.length} chunks`);
//         return captions;

//     } catch (error: any) {
//         console.error('❌ Caption generation failed:', error.message);
//         throw error;
//     }
// }

// // ═══════════════════════════════════════════════════════════════════════════════
// // MAIN API ROUTE
// // ═══════════════════════════════════════════════════════════════════════════════

// export async function POST(req: NextRequest) {
//     try {
//         const { chapter, courseId, chapterIndex } = await req.json();

//         console.log('\n' + '═'.repeat(80));
//         console.log('🎬 VIDEO CONTENT GENERATION');
//         console.log('═'.repeat(80));
//         console.log('Course:', courseId);
//         console.log('Chapter:', chapter.chapterTitle);
//         console.log('Index:', chapterIndex);
//         console.log('═'.repeat(80) + '\n');

//         // ═══════════════════════════════════════════════════════════════════
//         // Testing Mode Check
//         // ═══════════════════════════════════════════════════════════════════
//         if (TESTING_MODE && chapterIndex !== TEST_CHAPTER_INDEX) {
//             console.log(`⏭️ Skipping chapter ${chapterIndex} (testing mode)`);
//             return NextResponse.json({
//                 success: true,
//                 skipped: true,
//                 reason: `Testing mode: only processing chapter ${TEST_CHAPTER_INDEX}`
//             });
//         }

//         // ═══════════════════════════════════════════════════════════════════
//         // Check Existing Slides
//         // ═══════════════════════════════════════════════════════════════════
//         const existingSlides = await db
//             .select()
//             .from(chapterContentSlides)
//             .where(eq(chapterContentSlides.chapterId, chapter.chapterId));

//         if (existingSlides.length > 0) {
//             console.log(`✅ Slides already exist (${existingSlides.length})`);
//             return NextResponse.json({
//                 success: true,
//                 data: existingSlides,
//                 skipped: true,
//                 message: 'Slides already exist for this chapter'
//             });
//         }

//         // ═══════════════════════════════════════════════════════════════════
//         // Test Gemini Connection
//         // ═══════════════════════════════════════════════════════════════════
//         console.log('🔗 Testing Gemini API...');
//         try {
//             await gemini.test();
//             console.log('✅ Gemini connected');
//         } catch (error: any) {
//             console.error('❌ Gemini connection failed:', error.message);
//             return NextResponse.json(
//                 {
//                     success: false,
//                     error: 'Gemini API connection failed',
//                     details: error.message
//                 },
//                 { status: 500 }
//             );
//         }

//         // ═══════════════════════════════════════════════════════════════════
//         // Generate Slides with Gemini
//         // ═══════════════════════════════════════════════════════════════════
//         console.log('🤖 Generating slides with Gemini...');

//         let slidesData;
//         try {
//             const result = await gemini.json(
//                 GENERATE_VIDEO_PROMPT,
//                 JSON.stringify(chapter),
//                 {
//                     model: 'gemini-2.5-flash',
//                     temperature: 0.7,
//                     maxOutputTokens: 65536
//                 }
//             );

//             console.log('✅ Gemini response received');

//             // Handle response format
//             if (Array.isArray(result)) {
//                 slidesData = result;
//             } else if (result?.slides && Array.isArray(result.slides)) {
//                 slidesData = result.slides;
//             } else if (result?.data && Array.isArray(result.data)) {
//                 slidesData = result.data;
//             } else if (typeof result === 'object') {
//                 slidesData = [result];
//             } else {
//                 throw new Error('Invalid response format from Gemini');
//             }

//             console.log(`📊 Processing ${slidesData.length} slides`);

//         } catch (error: any) {
//             console.error('❌ Gemini generation failed:', error.message);
//             return NextResponse.json(
//                 {
//                     success: false,
//                     error: 'Failed to generate slides',
//                     details: error.message
//                 },
//                 { status: 500 }
//             );
//         }

//         if (!slidesData || slidesData.length === 0) {
//             throw new Error('No slides generated');
//         }

//         // ═══════════════════════════════════════════════════════════════════
//         // Process Each Slide
//         // ═══════════════════════════════════════════════════════════════════
//         const insertedSlides = [];

//         for (let i = 0; i < slidesData.length; i++) {
//             const slide = slidesData[i];

//             console.log(`\n${'─'.repeat(80)}`);
//             console.log(`🎬 Slide ${i + 1}/${slidesData.length}: ${slide.slideId || `slide-${i}`}`);
//             console.log(`${'─'.repeat(80)}`);

//             // Validate slide
//             if (!slide.narration?.fullText) {
//                 console.warn(`⚠️ Missing narration, skipping...`);
//                 continue;
//             }

//             const narration = slide.narration.fullText;
//             const wordCount = narration.split(/\s+/).length;
//             const estimatedMinutes = Math.ceil(wordCount / 180);

//             console.log(`📝 Narration: ${narration.length} chars, ${wordCount} words (~${estimatedMinutes} min)`);

//             try {
//                 // ═══════════════════════════════════════════════════════════
//                 // Step 1: Generate Audio (with chunking)
//                 // ═══════════════════════════════════════════════════════════
//                 console.log('🔊 Step 1: Generating audio...');
//                 const audioBuffer = await generateAudioForLongText(narration);
//                 console.log(`✅ Audio generated: ${audioBuffer.length} bytes`);

//                 // ═══════════════════════════════════════════════════════════
//                 // Step 2: Upload to Vercel Blob
//                 // ═══════════════════════════════════════════════════════════
//                 console.log('☁️ Step 2: Uploading to Vercel Blob...');
//                 const filename = `audio/${courseId}/${chapter.chapterId}/${slide.slideId || `slide-${i}`}.wav`;
//                 const { url } = await put(filename, audioBuffer, {
//                     access: 'public',
//                     contentType: 'audio/wav',
//                     allowOverwrite: true
//                 });
//                 console.log(`✅ Uploaded: ${url}`);

//                 // ═══════════════════════════════════════════════════════════
//                 // Step 3: Generate Captions
//                 // ═══════════════════════════════════════════════════════════
//                 console.log('🎬 Step 3: Generating captions...');
//                 const captions = await generateCaptions(url);
//                 console.log(`✅ Captions: ${captions.chunks.length} chunks`);

//                 // ═══════════════════════════════════════════════════════════
//                 // Step 4: Save to Database
//                 // ═══════════════════════════════════════════════════════════
//                 console.log('💾 Step 4: Saving to database...');
//                 const [insertedSlide] = await db.insert(chapterContentSlides).values({
//                     courseId: courseId,
//                     chapterId: chapter.chapterId,
//                     slideId: slide.slideId || `slide-${i}`,
//                     slideIndex: slide.slideIndex || i,
//                     audioUrl: url,
//                     narration: slide.narration,
//                     captions: captions,
//                     html: slide.html,
//                     revealData: slide.revealData || []
//                 }).returning();

//                 insertedSlides.push(insertedSlide);
//                 console.log(`✅ Slide ${i + 1} saved!`);

//             } catch (error: any) {
//                 console.error(`❌ Error processing slide ${i + 1}:`, error.message);
//                 console.error('Stack:', error.stack);

//                 // Continue with next slide instead of failing entire batch
//                 console.log('⏭️ Continuing to next slide...');
//                 continue;
//             }
//         }

//         // ═══════════════════════════════════════════════════════════════════
//         // Summary
//         // ═══════════════════════════════════════════════════════════════════
//         console.log('\n' + '═'.repeat(80));
//         console.log(`🎉 SUCCESS: Generated ${insertedSlides.length}/${slidesData.length} slides`);
//         console.log('═'.repeat(80) + '\n');

//         return NextResponse.json({
//             success: true,
//             data: insertedSlides,
//             metadata: {
//                 generatedAt: new Date().toISOString(),
//                 model: 'gemini-2.5-flash',
//                 courseId,
//                 chapterId: chapter.chapterId,
//                 totalSlides: insertedSlides.length,
//                 requestedSlides: slidesData.length,
//                 testingMode: TESTING_MODE
//             }
//         });

//     } catch (error: any) {
//         console.error('\n' + '═'.repeat(80));
//         console.error('🔥 VIDEO CONTENT GENERATION FAILED');
//         console.error('═'.repeat(80));
//         console.error('Error:', error.message);
//         console.error('Stack:', error.stack);
//         console.error('═'.repeat(80) + '\n');

//         return NextResponse.json(
//             {
//                 success: false,
//                 error: error.message || 'Failed to generate video content',
//                 details: process.env.NODE_ENV === 'development' ? error.stack : undefined
//             },
//             { status: 500 }
//         );
//     }
// }

import { db } from "@/config/db";
import { openrouter } from "@/config/openrouter";
import { chapterContentSlides } from "@/config/schema";
import { GENERATE_VIDEO_PROMPT } from "@/data/Prompt";
import { apiError, apiSuccess } from "@/lib/api-helpers";
import { validateInput, generateVideoContentSchema } from "@/lib/validations";
import { putWithRotation } from "@/lib/blob";
import { deleteSlidesContent, loadSlidesContent, saveSlidesContent } from "@/lib/content-cache";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// ═══════════════════════════════════════════════════════════════════════════════
// 🧪 TESTING MODE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
const TESTING_MODE = true;  // ⚠️ SET TO false TO GENERATE ALL CHAPTERS
const TEST_CHAPTER_INDEX = 9;  // Generate only this chapter (0 = first chapter)
const USE_CONTENT_CACHE = true;  // ⚠️ SET TO false TO FORCE LLM REGENERATION

console.log('🧪 TESTING MODE:', TESTING_MODE ? 'ENABLED (Single Chapter Only)' : 'DISABLED (All Chapters)');
if (TESTING_MODE) {
    console.log(`📌 Will only generate chapter at index: ${TEST_CHAPTER_INDEX}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📦 CONTENT CACHING CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
// When true:  LLM-generated slide content is cached in Vercel Blob.
//             On re-runs, cached content is reused (no LLM call).
//             This saves LLM costs when retrying after Sarvam/Blob errors.
// When false: Cache is deleted, LLM always regenerates fresh content.
 // ⚠️ SET TO false TO FORCE LLM REGENERATION

// ═══════════════════════════════════════════════════════════════════════════════
// 🔄 RETRY CONFIGURATION (Round-Robin for failed slides)
// ═══════════════════════════════════════════════════════════════════════════════
const MAX_SLIDE_RETRIES = 3;     // Max retry rounds for failed slides
const RETRY_DELAY_MS = 2000;     // Delay between retry rounds (ms)

console.log('📦 CONTENT CACHE:', USE_CONTENT_CACHE ? 'ENABLED' : 'DISABLED');
console.log(`🔄 MAX RETRIES: ${MAX_SLIDE_RETRIES} rounds`);

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

/**
 * Compute duration (in seconds) from a WAV buffer using its header.
 * This avoids fetching/decoding the audio file on the frontend.
 */
function getWavDurationFromBuffer(buffer: Buffer): number {
    if (buffer.length < 44) return 0;
    const header = parseWavHeader(buffer);
    if (!header) return 0;
    const dataSize = buffer.length - 44;
    const bytesPerSecond = header.sampleRate * header.numChannels * (header.bitsPerSample / 8);
    return bytesPerSecond > 0 ? dataSize / bytesPerSecond : 0;
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

async function generateAudioWithSarvam(text: string, languageCode: string = "en-IN"): Promise<Buffer> {
    if (text.length > 2500) {
        throw new Error(`Text too long for Sarvam AI: ${text.length} chars (max 2500)`);
    }

    console.log(`🎤 Generating audio: ${text.length} chars (${languageCode})`);

    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
        method: 'POST',
        headers: {
            'api-subscription-key': process.env.SARVAM_API_KEY!,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: text,
            target_language_code: languageCode,
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

async function generateAudioForLongText(text: string, languageCode: string = "en-IN"): Promise<Buffer> {
    console.log(`🎵 Processing long text: ${text.length} chars`);

    const chunks = chunkTextForTTS(text, 2400);

    if (chunks.length === 1) {
        return await generateAudioWithSarvam(chunks[0], languageCode);
    }

    console.log(`🔄 Generating ${chunks.length} audio chunks...`);
    const audioBuffers: Buffer[] = [];

    for (let i = 0; i < chunks.length; i++) {
        console.log(`🔊 Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);

        try {
            const audioBuffer = await generateAudioWithSarvam(chunks[i], languageCode);
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
async function generateCaptions(audioUrl: string, languageCode: string = "en-IN"): Promise<any> {
    try {
        console.log('🎯 Generating captions with Sarvam AI...');

        // Use Sarvam AI for transcription
        const transcription = await sarvam.transcribeAudio(audioUrl, languageCode);

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
        // Validate request body with Zod schema
        const body = await req.json();
        const validation = validateInput(generateVideoContentSchema, body);

        if (!validation.success) {
            console.error('❌ Validation Error:', validation.errors);
            return apiError('Invalid request input', 400, 'VALIDATION_ERROR', validation.errors);
        }

        const { chapter, courseId, courseName, chapterIndex } = validation.data;

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
            return apiSuccess({
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
            return apiSuccess({
                slides: existingSlides,
                skipped: true,
                message: 'Slides already exist for this chapter'
            });
        }

        // ═══════════════════════════════════════════════════════════════════
        // Test OpenRouter Connection
        // ═══════════════════════════════════════════════════════════════════
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

        // ═══════════════════════════════════════════════════════════════════
        // Generate Slides with OpenRouter
        // ═══════════════════════════════════════════════════════════════════
        console.log('🤖 Generating slides with OpenRouter...');
        console.log('📝 Chapter content length:', JSON.stringify(chapter).length, 'chars');

        let slidesData;
        try {
            // Try with the pony-alpha model (with reasoning)
            let result;
            try {
                console.log('🎯 Attempting with openrouter/pony-alpha (reasoning enabled)...');
                result = await openrouter.json(
                    GENERATE_VIDEO_PROMPT,
                    JSON.stringify(chapter),
                    {
                        model: 'openrouter/aurora-alpha',
                        temperature: 0.7,
                        maxTokens: 32000,
                        reasoning: true
                    }
                );
            } catch (primaryError: any) {
                console.warn('⚠️ Primary model failed, trying fallback...');
                console.warn('Primary error:', primaryError.message);
                
                // Fallback to gemini-flash as backup
                console.log('🔄 Attempting with google/gemini-flash-1.5 (fallback)...');
                result = await openrouter.json(
                    GENERATE_VIDEO_PROMPT,
                    JSON.stringify(chapter),
                    {
                        model: 'google/gemini-flash-1.5',
                        temperature: 0.7,
                        maxTokens: 32000,
                        reasoning: false  // Gemini doesn't support reasoning
                    }
                );
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
                // Try to extract any array from the response
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

        // ═══════════════════════════════════════════════════════════════════
        // SLIDE PROCESSING WITH RETRY (ROUND-ROBIN)
        // ═══════════════════════════════════════════════════════════════════
        // Process all slides. Failed slides are collected and retried in
        // subsequent rounds (up to MAX_SLIDE_RETRIES) until all succeed.
        // ═══════════════════════════════════════════════════════════════════

        const insertedSlides: any[] = [];
        const succeededIndices = new Set<number>();

        // Build initial list of slide indices to process
        let pendingIndices: number[] = [];
        for (let i = 0; i < slidesData.length; i++) {
            pendingIndices.push(i);
        }

        /**
         * Process a single slide: TTS → Blob upload → STT captions → DB save
         * Returns true on success, false on failure.
         */
        const processSlide = async (i: number, round: number): Promise<boolean> => {
            const slide = slidesData[i];
            const roundLabel = round > 0 ? ` [Retry round ${round}]` : '';

            console.log(`\n${'─'.repeat(80)}`);
            console.log(`🎬 Slide ${i + 1}/${slidesData.length}: ${slide.slideId || `slide-${i}`}${roundLabel}`);
            console.log(`${'─'.repeat(80)}`);

            // Validate slide
            if (!slide.narration?.fullText) {
                console.warn(`⚠️ Missing narration, skipping permanently...`);
                succeededIndices.add(i); // Don't retry invalid slides
                return true;
            }

            const narration = slide.narration.fullText;
            const wordCount = narration.split(/\s+/).length;
            const estimatedMinutes = Math.ceil(wordCount / 180);

            console.log(`📝 Narration: ${narration.length} chars, ${wordCount} words (~${estimatedMinutes} min)`);

            try {
                // Step 1: Generate Audio (with chunking)
                console.log('🔊 Step 1: Generating audio...');
                const audioBuffer = await generateAudioForLongText(narration, 'en-IN'); // Defaulting to en-IN for main course for now, or use props if available
                const audioDuration = getWavDurationFromBuffer(audioBuffer);
                console.log(`✅ Audio generated: ${audioBuffer.length} bytes, duration: ${audioDuration.toFixed(2)}s`);

                // Step 2: Upload to Vercel Blob
                console.log('☁️ Step 2: Uploading to Vercel Blob...');
                const filename = `audio/${courseId}/${chapter.chapterId}/${slide.slideId || `slide-${i}`}.wav`;
                const { url } = await putWithRotation(filename, audioBuffer, {
                    access: 'public',
                    contentType: 'audio/wav',
                    allowOverwrite: true
                });
                console.log(`✅ Uploaded: ${url}`);

                // Step 3: Generate Captions with Sarvam AI
                console.log('🎬 Step 3: Generating captions with Sarvam AI...');
                const captions = await generateCaptions(url, 'en-IN'); // Defaulting to en-IN for main course
                console.log(`✅ Captions: ${captions.chunks.length} chunks`);

                // Step 4: Save to Database (upsert — handles retries gracefully)
                console.log('💾 Step 4: Saving to database...');
                const slideIdValue = slide.slideId || `slide-${i}`;
                const slideValues = {
                    courseId: courseId,
                    chapterId: chapter.chapterId,
                    slideId: slideIdValue,
                    slideIndex: slide.slideIndex || i,
                    audioUrl: url,
                    audioDuration: audioDuration,
                    narration: slide.narration,
                    captions: captions,
                    html: slide.html,
                    revealData: slide.fragmentData || slide.revealData || []
                };

                const [insertedSlide] = await db.insert(chapterContentSlides)
                    .values(slideValues)
                    .onConflictDoUpdate({
                        target: chapterContentSlides.slideId,
                        set: {
                            audioUrl: url,
                            audioDuration: audioDuration,
                            narration: slide.narration,
                            captions: captions,
                            html: slide.html,
                            revealData: slide.fragmentData || slide.revealData || [],
                            slideIndex: slide.slideIndex || i,
                        }
                    })
                    .returning();

                insertedSlides.push(insertedSlide);
                console.log(`✅ Slide ${i + 1} saved! (slideId: ${slideIdValue})`);
                return true;

            } catch (error: any) {
                console.error(`❌ Error processing slide ${i + 1}:`, error.message);
                if (error.code) console.error('   PG Error Code:', error.code);
                if (error.detail) console.error('   PG Detail:', error.detail);
                if (error.constraint) console.error('   PG Constraint:', error.constraint);
                console.error('Stack:', error.stack);
                return false;
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // ROUND 0: Initial pass — process all slides
        // ─────────────────────────────────────────────────────────────────
        console.log(`\n${'═'.repeat(80)}`);
        console.log(`🎬 Processing ${pendingIndices.length} slides (initial pass)`);
        console.log(`${'═'.repeat(80)}`);

        let failedIndices: number[] = [];
        for (const idx of pendingIndices) {
            const success = await processSlide(idx, 0);
            if (success) {
                succeededIndices.add(idx);
            } else {
                failedIndices.push(idx);
                console.log('⏭️ Will retry this slide later...');
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // RETRY ROUNDS: Round-robin for failed slides
        // ─────────────────────────────────────────────────────────────────
        for (let round = 1; round <= MAX_SLIDE_RETRIES && failedIndices.length > 0; round++) {
            console.log(`\n${'═'.repeat(80)}`);
            console.log(`🔄 Retry round ${round}/${MAX_SLIDE_RETRIES}: retrying ${failedIndices.length} failed slide(s)`);
            console.log(`   Failed slide indices: [${failedIndices.join(', ')}]`);
            console.log(`${'═'.repeat(80)}`);

            // Wait before retrying (give external services time to recover)
            console.log(`⏳ Waiting ${RETRY_DELAY_MS}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));

            const stillFailed: number[] = [];
            for (const idx of failedIndices) {
                const success = await processSlide(idx, round);
                if (success) {
                    succeededIndices.add(idx);
                    console.log(`✅ Slide ${idx + 1} succeeded on retry round ${round}!`);
                } else {
                    stillFailed.push(idx);
                    console.log(`❌ Slide ${idx + 1} still failing (round ${round}/${MAX_SLIDE_RETRIES})`);
                }
            }

            failedIndices = stillFailed;
        }

        // ─────────────────────────────────────────────────────────────────
        // FINAL SUMMARY
        // ─────────────────────────────────────────────────────────────────
        console.log('\n' + '═'.repeat(80));
        console.log(`🎉 RESULT: Generated ${insertedSlides.length}/${slidesData.length} slides`);
        if (failedIndices.length > 0) {
            console.log(`⚠️ ${failedIndices.length} slide(s) still failed after ${MAX_SLIDE_RETRIES} retries: [${failedIndices.join(', ')}]`);
        } else {
            console.log(`✅ ALL slides generated successfully!`);
        }
        console.log(`📦 Content source: ${contentFromCache ? 'cached' : 'fresh LLM generation'}`);
        console.log('═'.repeat(80) + '\n');

        return apiSuccess({
            slides: insertedSlides,
            metadata: {
                generatedAt: new Date().toISOString(),
                model: 'openrouter/aurora-alpha',
                courseId,
                chapterId: chapter.chapterId,
                totalSlides: insertedSlides.length,
                requestedSlides: slidesData.length,
                failedSlides: failedIndices.length,
                retriesUsed: failedIndices.length > 0 ? MAX_SLIDE_RETRIES : (insertedSlides.length < slidesData.length ? 'some' : 0),
                contentFromCache,
                contentCacheEnabled: USE_CONTENT_CACHE,
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

        return apiError(
            error.message || 'Failed to generate video content',
            500,
            'GENERATION_ERROR',
            error.stack
        );
    }
}