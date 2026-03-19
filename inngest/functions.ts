import { db } from "@/config/db";
import { gemini } from "@/config/gemini";
import { shortVideoAssets, shortVideoSeries } from "@/config/schema";
import { putWithRotation } from "@/lib/blob";
import { getMusicUrl } from "@/lib/music-urls";
import { generateRunwayImage, ContentModerationError } from "@/lib/runway";
import { generateNanoBananaImage } from "@/lib/leonardo";
import { triggerRender } from "@/lib/video-render";
import { and, eq, or } from "drizzle-orm";
import { inngest } from "./client";


// ─── Sarvam TTS helpers (reusing patterns from lib/enhanced-tts.ts) ──────────

function sanitizeForTTS(text: string): string {
    return text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[•◦▪▫]/g, '-')
        .replace(/[…]/g, '...')
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/\.{4,}/g, '...')
        .replace(/!{2,}/g, '!')
        .replace(/\?{2,}/g, '?')
        .replace(/([.!?])([A-Z])/g, '$1 $2')
        .trim();
}

function chunkText(text: string, maxLen = 2200): string[] {
    if (text.length <= maxLen) return [text];
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
    const chunks: string[] = [];
    let cur = '';
    for (const s of sentences) {
        const t = s.trim();
        if (!t) continue;
        if (cur.length + t.length + 1 > maxLen && cur) {
            chunks.push(cur.trim());
            cur = t;
        } else {
            cur += (cur ? ' ' : '') + t;
        }
    }
    if (cur) chunks.push(cur.trim());
    return chunks;
}

async function callSarvamTTS(
    text: string,
    speaker: string,
    language: string,
    retries = 3
): Promise<Buffer> {
    let lastErr: Error | null = null;
    let delay = 2000;

    for (let i = 0; i <= retries; i++) {
        try {
            if (i > 0) {
                console.log(`🔄 TTS retry ${i}/${retries}, waiting ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 10000);
            }

            const res = await fetch('https://api.sarvam.ai/text-to-speech', {
                method: 'POST',
                headers: {
                    'api-subscription-key': process.env.SARVAM_API_KEY!,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text,
                    target_language_code: language,
                    speaker,
                    pace: 1.05,
                    speech_sample_rate: 22050,
                    enable_preprocessing: true,
                    model: "bulbul:v3",
                    temperature: 0.6,
                    output_audio_codec: "wav",
                }),
                signal: AbortSignal.timeout(30000),
            });

            if (!res.ok) {
                throw new Error(`Sarvam TTS ${res.status}: ${await res.text()}`);
            }

            const data = await res.json();
            if (!data.audios?.[0]) throw new Error('No audio in Sarvam response');

            return Buffer.from(data.audios[0], 'base64');
        } catch (e: any) {
            lastErr = e;
            const retryable = /502|503|504|timeout|ECONNRESET/i.test(e.message);
            if (!retryable || i === retries) throw e;
            console.warn(`⚠️ TTS attempt ${i + 1} failed: ${e.message}`);
        }
    }
    throw lastErr!;
}

function mergeWavBuffers(buffers: Buffer[]): Buffer {
    if (buffers.length === 1) return buffers[0];
    const chunks = buffers.map(b => b.slice(44)); // strip headers
    const merged = Buffer.concat(chunks);
    const hdr = Buffer.alloc(44);
    const first = buffers[0];
    hdr.write('RIFF', 0);
    hdr.writeUInt32LE(merged.length + 36, 4);
    hdr.write('WAVE', 8);
    hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16);
    hdr.writeUInt16LE(1, 20);
    hdr.writeUInt16LE(first.readUInt16LE(22), 22); // channels
    hdr.writeUInt32LE(first.readUInt32LE(24), 24); // sample rate
    hdr.writeUInt32LE(first.readUInt32LE(28), 28); // byte rate
    hdr.writeUInt16LE(first.readUInt16LE(32), 32); // block align
    hdr.writeUInt16LE(first.readUInt16LE(34), 34); // bits per sample
    hdr.write('data', 36);
    hdr.writeUInt32LE(merged.length, 40);
    return Buffer.concat([hdr, merged]);
}

// ─── Inngest functions ───────────────────────────────────────────────────────

export const helloWorld = inngest.createFunction(
    { id: "hello-world" },
    { event: "test/hello.world" },
    async ({ event, step }) => {
        await step.sleep("wait-a-moment", "1s");
        return { message: `Hello ${event.data.email}!` };
    }
);

// Helper to update series status in DB
async function updateSeriesStatus(seriesId: string, status: string) {
    await db.update(shortVideoSeries)
        .set({ status, updatedAt: new Date() })
        .where(eq(shortVideoSeries.seriesId, seriesId));
}

export const generateShortVideo = inngest.createFunction(
    {
        id: "generate-short-video",
        cancelOn: [
            {
                event: "shorts/generate.cancel",
                match: "data.seriesId"
            }
        ],
        onFailure: async ({ error, event, step }) => {
            const seriesId = event?.data?.event?.data?.seriesId;
            if (seriesId) {
                console.error(`❌ Generation job failed or cancelled for series: ${seriesId}`, error);
                await updateSeriesStatus(seriesId, "completed"); // Reset status to hide generating UI

                // Also clean up any video assets stuck in processing/rendering
                await db.update(shortVideoAssets)
                    .set({ status: "failed" })
                    .where(and(
                        eq(shortVideoAssets.seriesId, seriesId),
                        or(
                            eq(shortVideoAssets.status, "processing"),
                            eq(shortVideoAssets.status, "rendering")
                        )
                    ));
            }
        }
    },
    { event: "shorts/generate.video" },
    async ({ event, step }) => {
        const { seriesId, customTopic } = event.data;

        // Step 1: Fetch series from DB
        const seriesData = await step.run("fetch-series", async () => {
            const [series] = await db
                .select()
                .from(shortVideoSeries)
                .where(eq(shortVideoSeries.seriesId, seriesId));

            if (!series) {
                throw new Error(`Series not found: ${seriesId}`);
            }

            console.log(`✅ Fetched series: "${series.title}"`);
            return series;
        });

        // Update status: generating script
        await step.run("update-status-script", () => updateSeriesStatus(seriesId, "generating:script"));

        // Step 2: Generate Video Script using Sarvam-105B
        const scriptData = await step.run("generate-video-script", async () => {
            console.log(`📝 Generating video script for: "${seriesData.title}"`);

            // ── Always target 80-120 seconds for engaging short videos ──
            const sceneCount = 6;
            const durationLabel = "80-120 seconds";

            // ── Word-count math ──────────────────────────────────────
            // Sarvam TTS at 1.05× pace ≈ 2.5 words/sec (150 WPM)
            const WORDS_PER_SEC = 2.5;
            const targetMinSec = 80;
            const targetMaxSec = 120;
            const totalWordsMin = Math.ceil(targetMinSec * WORDS_PER_SEC);   // 200
            const totalWordsMax = Math.ceil(targetMaxSec * WORDS_PER_SEC);   // 300
            const perSceneWordsMin = Math.ceil(totalWordsMin / sceneCount);   // ~34
            const perSceneWordsMax = Math.ceil(totalWordsMax / sceneCount);   // ~50
            // ─────────────────────────────────────────────────────────

            // ── Randomization seed for guaranteed uniqueness ─────────
            const seed = Date.now();
            const contentAngles = [
                "a mind-blowing fact nobody talks about",
                "a dark or hidden truth that will shock viewers",
                "a controversial take that challenges common beliefs",
                "an untold origin story or historical mystery",
                "a future prediction that sounds crazy but is backed by science",
                "a comparison that puts things into jaw-dropping perspective",
                "a secret technique or life hack most people don't know",
                "a story of an underdog or forgotten genius",
                "a bizarre connection between two unrelated things",
                "a countdown of the most insane facts about the topic",
                "a what-if scenario that changes everything",
                "a debunking of a popular myth with surprising evidence",
            ];
            const angle = contentAngles[seed % contentAngles.length];
            const randomTopicTwist = customTopic
                ? `SPECIFIC TOPIC (USER REQUEST): The user wants this video to be specifically about: "${customTopic}". Focus entirely on this topic. Make it engaging, viral, and packed with fascinating details. Seed: ${seed}`
                : `UNIQUE ANGLE: Frame this video as ${angle}. Seed: ${seed}`;
            // ─────────────────────────────────────────────────────────

            const systemPrompt = `You are a viral storyteller. Write a ${durationLabel} script.

🚨 SUPER CRITICAL RULES:
1. Output ONLY a valid JSON object.
2. Your JSON MUST be wrapped exactly in <json> and </json> tags.
3. NEVER output markdown code blocks (like \`\`\`json).

SCRIPT REQUIREMENTS:
1. TOTAL LENGTH: 250-300 words of narration.
2. STRUCTURE: You MUST use explicit keys ("scene1", "scene2"..."scene6") instead of an array.
3. LANGUAGE & NATIVE FLOW: Write ENTIRELY in ${seriesData.language === 'hi-IN' ? 'HINDI' : 'ENGLISH'}. You MUST use natural, native-sounding phrasing. Do NOT just translate English idioms literally. The narration MUST flow seamlessly and logically from one scene to the next.
4. NARRATION STYLE: Write a seamless, highly engaging story or compelling argument. Do NOT use meta-commentary, structural announcements, or "content framing" (e.g., NEVER say "Scene 1", "Here is a story about...", "Welcome to the video"). Start directly with the hook. The points MUST be highly interesting and directly address the user's title. Each scene must have 40-50 words (3-4 descriptive sentences).
5. IMAGE PROMPTS: Write highly detailed, masterpiece-level image generation prompts (20-30 words) focusing on cinematic lighting, photorealism, and striking visuals. DO NOT write ugly or generic descriptions.

JSON SCHEMA:
Do NOT use a "scenes" array. Use exact keys (scene1, scene2, etc.). Return exactly this wrapped in <json> tags:

<json>
{
  "videoTitle": "compelling viral title",
  "totalScenes": ${sceneCount},
  "totalWordCount": 250,
  "scene1": {
    "narration": "Gripping segment with NO intro framing (40-50 words)...",
    "imagePrompt": "Cinematic, photorealistic masterpiece visual description...",
    "duration": 15,
    "wordCount": 45
  },
  "scene2": {
    "narration": "Seamlessly continuing segment...",
    "imagePrompt": "Next cinematic visual...",
    "duration": 15,
    "wordCount": 45
  },
  "scene3": { ... },
  "scene4": { ... },
  "scene5": { ... },
  "scene6": { ... }
}
</json>

🚨 CRITICAL: Finish all ${sceneCount} scenes. Output ONLY <json>{...}</json>.`;

            const userPrompt = `Topic: "${seriesData.title}"
${randomTopicTwist}

ACT AS A PROFESSIONAL WRITER: 
Compose a high-retention, EXACTLY 6-scene script for this topic. 
You MUST provide 250+ total words of narration across all 6 scenes. 
You MUST use explicit keys (scene1, scene2, etc.). Do NOT use an array for scenes.
Do NOT use any "content framing" (like "Let's explore", "Scene 1"). Just write the pure narration.
Do NOT be brief. Do NOT stop early.

OUTPUT REQUIREMENT:
Output ONLY your JSON object wrapped exactly in <json> and </json> tags.`;

            // ── Generate with validation + retry ─────────────────────
            const MAX_ATTEMPTS = 3;
            let bestResult: any = null;
            let bestWordCount = 0;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                console.log(`🔄 Script generation attempt ${attempt}/${MAX_ATTEMPTS} (Gemini 2.5 Flash)...`);

                try {
                    const result = await gemini.json(systemPrompt, userPrompt, {
                        temperature: attempt === 1 ? 0.75 : 0.85,
                        maxOutputTokens: 8192,
                    });

                    // ── Map explicit keys back to scenes array ────────────────
                    if (!result.scenes || !Array.isArray(result.scenes) || result.scenes.length === 0) {
                        const extractedScenes: any[] = [];
                        for (let i = 1; i <= sceneCount; i++) {
                            const sceneKey = `scene${i}`;
                            if (result[sceneKey]) {
                                extractedScenes.push({
                                    ...result[sceneKey],
                                    sceneNumber: i
                                });
                                delete result[sceneKey]; // cleanup
                            }
                        }
                        result.scenes = extractedScenes;
                    }

                    if (!result.scenes || result.scenes.length < sceneCount) {
                        throw new Error(`Generated only ${result.scenes?.length || 0} scenes, expected ${sceneCount}. Model likely truncated or ignored instructions.`);
                    }

                    // Count actual words across all scenes
                    const actualWordCount = result.scenes.reduce(
                        (sum: number, s: any) => sum + (s.narration?.split(/\s+/).length || 0),
                        0
                    );

                    console.log(`📊 Attempt ${attempt}: ${actualWordCount} words (target: ${totalWordsMin}-${totalWordsMax}), ${result.scenes.length} scenes`);

                    // Keep the best result
                    if (actualWordCount > bestWordCount) {
                        bestResult = result;
                        bestWordCount = actualWordCount;
                    }

                    // If word count is acceptable, use this result
                    if (actualWordCount >= totalWordsMin * 0.85) {
                        console.log(`✅ Word count OK (${actualWordCount} ≥ ${Math.floor(totalWordsMin * 0.85)})`);
                        break;
                    }

                    console.warn(`⚠️ Word count too low: ${actualWordCount} < ${totalWordsMin} (need 85%+)`);
                } catch (err: any) {
                    console.error(`❌ Attempt ${attempt} failed: ${err.message}`);
                    // Continue to next attempt
                }
            }

            if (!bestResult) {
                throw new Error('All script generation attempts failed. Please try again.');
            }

            // Recalculate accurate durations based on actual word counts
            if (bestResult?.scenes) {
                for (const scene of bestResult.scenes) {
                    const words = scene.narration?.split(/\s+/).length || 0;
                    scene.wordCount = words;
                    scene.duration = Math.round(words / WORDS_PER_SEC);
                }
                bestResult.totalWordCount = bestWordCount;
            }

            console.log(`✅ Script finalized (Gemini 2.5 Flash): "${bestResult.videoTitle}" | ${bestResult.scenes?.length} scenes | ${bestWordCount} words ≈ ${Math.round(bestWordCount / WORDS_PER_SEC)}s`);
            return bestResult;
        });

        // Update status: generating voice
        await step.run("update-status-voice", () => updateSeriesStatus(seriesId, "generating:voice"));

        // Step 3: Generate Voice using TTS (Sarvam)
        const voiceData = await step.run("generate-voice", async () => {
            console.log(`🎙️ Generating voice for: "${seriesData.title}"`);

            // Combine all scene narrations into full script
            const fullNarration = scriptData.scenes
                .map((s: any) => s.narration)
                .join(' ');

            console.log(`📝 Full narration: ${fullNarration.length} chars`);

            // Sanitize text for TTS
            const cleaned = sanitizeForTTS(fullNarration);

            // Chunk if needed (Sarvam max ~2500 chars)
            const chunks = chunkText(cleaned, 2200);
            console.log(`✂️ Split into ${chunks.length} chunk(s)`);

            // Generate audio for each chunk
            const audioBuffers: Buffer[] = [];
            for (let i = 0; i < chunks.length; i++) {
                console.log(`🔊 Chunk ${i + 1}/${chunks.length}: ${chunks[i].length} chars`);
                const buf = await callSarvamTTS(
                    chunks[i],
                    seriesData.voice,      // speaker from series (e.g. "kabir")
                    seriesData.language,    // language from series (e.g. "en-IN")
                );
                audioBuffers.push(buf);

                // Rate-limit between chunks
                if (i < chunks.length - 1) {
                    await new Promise(r => setTimeout(r, 1000 + i * 200));
                }
            }

            // Merge chunks into single WAV
            const finalAudio = mergeWavBuffers(audioBuffers);
            console.log(`🔗 Merged audio: ${finalAudio.length} bytes`);

            // Estimate duration from WAV data (sample rate 22050, 16-bit mono)
            const sampleRate = finalAudio.readUInt32LE(24);
            const dataSize = finalAudio.length - 44;
            const bytesPerSample = finalAudio.readUInt16LE(34) / 8;
            const channels = finalAudio.readUInt16LE(22);
            const audioDuration = dataSize / (sampleRate * bytesPerSample * channels);
            console.log(`⏱️ Estimated duration: ${audioDuration.toFixed(1)}s`);

            // Upload to Vercel Blob with token rotation (unique path per generation)
            const blobResult = await putWithRotation(
                `shorts/${seriesData.seriesId}/audio_${Date.now()}.wav`,
                finalAudio,
                { access: "public", contentType: "audio/wav" }
            );

            console.log(`✅ Audio uploaded: ${blobResult.url}`);
            return {
                audioUrl: blobResult.url,
                audioDuration: Math.round(audioDuration * 10) / 10,
            };
        });

        // Update status: generating captions
        await step.run("update-status-captions", () => updateSeriesStatus(seriesId, "generating:captions"));

        // Step 4: Generate Captions using Sarvam Batch STT (handles >30s audio)
        const captionData = await step.run("generate-captions", async () => {
            console.log(`📄 Generating captions for: "${seriesData.title}"`);

            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            const { SarvamAIClient } = require('sarvamai');

            // Initialize Sarvam SDK client
            const sarvamClient = new SarvamAIClient({
                apiSubscriptionKey: process.env.SARVAM_API_KEY!,
            });

            // Step A: Download the audio from Vercel Blob
            console.log(`📥 Downloading audio from: ${voiceData.audioUrl}`);
            const audioRes = await fetch(voiceData.audioUrl);
            if (!audioRes.ok) {
                throw new Error(`Failed to download audio: ${audioRes.status}`);
            }
            const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
            console.log(`✅ Downloaded audio: ${audioBuffer.length} bytes`);

            // Step B: Write audio to a temp file (SDK needs file path)
            const tempDir = os.tmpdir();
            const tempFileName = `shorts_audio_${Date.now()}.wav`;
            const tempFilePath = path.join(tempDir, tempFileName);
            fs.writeFileSync(tempFilePath, audioBuffer);
            console.log(`📝 Temp file created: ${tempFilePath}`);

            try {
                // Step C: Create batch STT job
                console.log(`🔄 Creating Sarvam batch STT job...`);
                const job = await sarvamClient.speechToTextJob.createJob({
                    model: "saaras:v3",
                    // @ts-ignore
                    mode: "transcribe",
                    languageCode: seriesData.language || "en-IN",
                    withTimestamps: true,
                    withDiarization: false,
                    numSpeakers: 1,
                });
                console.log(`✅ Batch job created`);

                // Step D: Upload audio file to job
                console.log(`📤 Uploading audio to Sarvam AI...`);
                await job.uploadFiles([tempFilePath]);
                console.log(`✅ Audio uploaded`);

                // Step E: Start processing
                console.log(`⚙️ Starting transcription job...`);
                await job.start();
                console.log(`✅ Job started`);

                // Step F: Wait for completion
                console.log(`⏳ Waiting for transcription to complete...`);
                await job.waitUntilComplete();
                console.log(`✅ Transcription complete!`);

                // Step G: Get results
                console.log(`📊 Fetching results...`);
                const fileResults = await job.getFileResults();

                // Check for failures
                if (fileResults.failed && fileResults.failed.length > 0) {
                    throw new Error(`STT failed: ${fileResults.failed[0].error_message}`);
                }
                if (!fileResults.successful || fileResults.successful.length === 0) {
                    throw new Error('No successful transcription results');
                }

                // Step H: Download and parse output
                console.log(`📥 Downloading transcription output...`);
                const outputDir = path.join(tempDir, `sarvam_stt_${Date.now()}`);
                fs.mkdirSync(outputDir, { recursive: true });

                await job.downloadOutputs(outputDir);
                console.log(`✅ Output downloaded to: ${outputDir}`);

                // Step I: Read the JSON output file
                const outputFiles = fs.readdirSync(outputDir);
                const jsonFile = outputFiles.find((f: string) => f.endsWith('.json'));

                if (!jsonFile) {
                    throw new Error('No JSON output file found in STT results');
                }

                const outputPath = path.join(outputDir, jsonFile);
                const outputData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
                console.log(`📄 STT output keys: ${Object.keys(outputData)}`);

                const fullText = outputData.transcript || outputData.text || '';
                console.log(`📝 Transcript: ${fullText.substring(0, 100)}...`);

                // Step J: Extract word-level timestamps
                const timestamps: Array<{ word: string; start: number; end: number }> = [];

                if (outputData.words && Array.isArray(outputData.words)) {
                    for (const w of outputData.words) {
                        timestamps.push({
                            word: w.word || w.text || '',
                            start: w.start || w.start_time || 0,
                            end: w.end || w.end_time || 0,
                        });
                    }
                } else if (outputData.segments && Array.isArray(outputData.segments)) {
                    for (const seg of outputData.segments) {
                        if (seg.words && Array.isArray(seg.words)) {
                            for (const w of seg.words) {
                                timestamps.push({
                                    word: w.word || w.text || '',
                                    start: w.start || w.start_time || 0,
                                    end: w.end || w.end_time || 0,
                                });
                            }
                        }
                    }
                } else if (outputData.timestamps && Array.isArray(outputData.timestamps)) {
                    for (const t of outputData.timestamps) {
                        timestamps.push({
                            word: t.word || t.text || '',
                            start: t.start ?? t.start_time ?? 0,
                            end: t.end ?? t.end_time ?? 0,
                        });
                    }
                }

                // Fallback: estimate timestamps from transcript
                if (timestamps.length === 0 && fullText) {
                    console.warn('⚠️ No word timestamps in output, using estimated timing');
                    const words = fullText.split(/\s+/);
                    const avgDuration = (voiceData.audioDuration || 60) / words.length;
                    words.forEach((w: string, i: number) => {
                        timestamps.push({
                            word: w,
                            start: +(i * avgDuration).toFixed(2),
                            end: +((i + 1) * avgDuration).toFixed(2),
                        });
                    });
                }

                console.log(`📊 Extracted ${timestamps.length} word timestamps`);

                // Clean up temp files
                try {
                    fs.unlinkSync(tempFilePath);
                    fs.rmSync(outputDir, { recursive: true, force: true });
                    console.log('🗑️ Temp files cleaned up');
                } catch (e) {
                    console.warn('⚠️ Cleanup failed:', e);
                }

                // Group words into caption segments (~4 words each)
                const WORDS_PER_SEGMENT = 4;
                const segments: Array<{
                    text: string;
                    start: number;
                    end: number;
                    words: typeof timestamps;
                }> = [];

                for (let i = 0; i < timestamps.length; i += WORDS_PER_SEGMENT) {
                    const group = timestamps.slice(i, i + WORDS_PER_SEGMENT);
                    segments.push({
                        text: group.map(w => w.word).join(' '),
                        start: group[0].start,
                        end: group[group.length - 1].end,
                        words: group,
                    });
                }

                console.log(`✅ Created ${segments.length} caption segments`);

                return {
                    transcript: fullText,
                    language: seriesData.language,
                    wordTimestamps: timestamps,
                    segments,
                };

            } catch (error: any) {
                // Clean up temp file on error
                try { fs.unlinkSync(tempFilePath); } catch { }
                console.error(`❌ Sarvam Batch STT Error: ${error.message}`);
                throw error;
            }
        });

        // Update status: generating images
        await step.run("update-status-images", () => updateSeriesStatus(seriesId, "generating:images"));

        // Step 5: Generate Images — RunwayML primary, Leonardo Nano Banana fallback
        const imageData = await step.run("generate-images", async () => {
            console.log(`🖼️ Generating images for: "${seriesData.title}"`);
            console.log(`📸 Scenes to generate: ${scriptData.scenes?.length}`);

            const IMAGE_RATIO = "768:1344"; // RunwayML portrait for vertical shorts (9:16)
            const LEONARDO_WIDTH = 768;      // Leonardo portrait dimensions
            const LEONARDO_HEIGHT = 1376;
            const MAX_RETRIES_PER_SCENE = 3;
            const totalScenes = scriptData.scenes.length;
            const imageUrls: string[] = new Array(totalScenes).fill("");

            // ── Force-stop check: query DB to see if series was cancelled ──
            async function isForceStoppedCheck(): Promise<boolean> {
                const [current] = await db.select({ status: shortVideoSeries.status })
                    .from(shortVideoSeries)
                    .where(eq(shortVideoSeries.seriesId, seriesId));
                if (!current || current.status === "completed" || current.status === "cancelled") {
                    console.log(`🛑 Force stop detected! Series status is "${current?.status}". Aborting all image generation.`);
                    return true;
                }
                return false;
            }

            // ── Helper: try Leonardo Nano Banana as fallback ──
            async function tryLeonardoFallback(prompt: string, sceneNum: number): Promise<string | null> {
                console.log(`🎨 Falling back to Leonardo Nano Banana for Scene ${sceneNum}...`);
                try {
                    const imageUrl = await generateNanoBananaImage(prompt, LEONARDO_WIDTH, LEONARDO_HEIGHT);
                    console.log(`✅ Leonardo fallback succeeded for Scene ${sceneNum}: ${imageUrl.substring(0, 60)}...`);
                    return imageUrl;
                } catch (err: any) {
                    console.error(`❌ Leonardo fallback also failed for Scene ${sceneNum}: ${err?.message || err}`);
                    return null;
                }
            }

            // ── Generate all scenes ────────────────────────────────
            for (let i = 0; i < totalScenes; i++) {
                if (await isForceStoppedCheck()) break;

                const prompt = scriptData.scenes[i].imagePrompt;
                console.log(`🖼️ Scene ${i + 1}/${totalScenes}: "${prompt.substring(0, 80)}..."`);

                let success = false;

                // Try RunwayML first (with retries for non-moderation errors)
                for (let attempt = 1; attempt <= MAX_RETRIES_PER_SCENE; attempt++) {
                    if (await isForceStoppedCheck()) break;

                    try {
                        const imageUrl = await generateRunwayImage(prompt, IMAGE_RATIO);
                        imageUrls[i] = imageUrl;
                        console.log(`✅ Scene ${i + 1} image (RunwayML, attempt ${attempt}): ${imageUrl.substring(0, 60)}...`);
                        success = true;
                        break;
                    } catch (err: any) {
                        console.error(`❌ Scene ${i + 1} RunwayML attempt ${attempt}/${MAX_RETRIES_PER_SCENE} FAILED: ${err?.message || err}`);

                        // Content moderation or generation failure → immediately switch to Leonardo
                        if (err instanceof ContentModerationError || err?.message?.includes('content moderation') || err?.message?.includes('Failed to generate')) {
                            console.log(`🛡️ Content moderation blocked Scene ${i + 1}. Switching to Leonardo Nano Banana...`);
                            const fallbackUrl = await tryLeonardoFallback(prompt, i + 1);
                            if (fallbackUrl) {
                                imageUrls[i] = fallbackUrl;
                                success = true;
                            }
                            break; // Don't retry RunwayML for moderation errors
                        }

                        // For other errors (rate limit, network), retry with backoff
                        if (attempt < MAX_RETRIES_PER_SCENE) {
                            const backoff = Math.min(5000 * Math.pow(2, attempt - 1), 30000) + Math.random() * 3000;
                            console.log(`⏳ Retrying scene ${i + 1} in ${Math.round(backoff)}ms...`);
                            await new Promise(r => setTimeout(r, backoff));
                        }
                    }
                }

                // Rate-limit between scenes
                if (i < totalScenes - 1) {
                    const delay = 3000 + Math.random() * 2000;
                    await new Promise(r => setTimeout(r, delay));
                }
            }

            // ── Sweep: use Leonardo for any remaining empty scenes ───
            if (!(await isForceStoppedCheck())) {
                const failedIndices = imageUrls.map((url, i) => url === "" ? i : -1).filter(i => i !== -1);

                if (failedIndices.length > 0) {
                    console.log(`🔄 Sweep: ${failedIndices.length} scenes still missing. Trying Leonardo for each...`);
                    for (const idx of failedIndices) {
                        if (await isForceStoppedCheck()) break;
                        const prompt = scriptData.scenes[idx].imagePrompt;
                        const fallbackUrl = await tryLeonardoFallback(prompt, idx + 1);
                        if (fallbackUrl) {
                            imageUrls[idx] = fallbackUrl;
                        }
                    }
                }
            }

            const successCount = imageUrls.filter(u => u.length > 0).length;
            console.log(`✅ Final result: ${successCount}/${totalScenes} images generated`);

            if (successCount < totalScenes) {
                console.warn(`⚠️ ${totalScenes - successCount} scene image(s) could not be generated after all attempts.`);
            }

            return { imageUrls };
        });

        // Update status: video
        await step.run("update-status-video", () => updateSeriesStatus(seriesId, "generating:video"));

        // Step 5: (Implicitly handled by previous steps being done)
        const assetPreparation = await step.run("prepare-assets", async () => {
            console.log(`✅ Assets prepared for: "${seriesData.title}"`);
            return { ready: true };
        });

        // Update status: render
        await step.run("update-status-render", () => updateSeriesStatus(seriesId, "generating:render"));

        // Step 6: Trigger MP4 rendering & Save Initial Record
        const videoResult = await step.run("render-and-save", async () => {
            const videoId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const musicUrl = getMusicUrl(seriesData.music);
            const props = {
                imageUrls: imageData.imageUrls,
                audioUrl: voiceData.audioUrl,
                musicUrl,
                captionData: captionData,
                captionStyle: seriesData.captionStyle,
                language: seriesData.language || 'en-IN',
                durationInFrames: Math.floor((voiceData.audioDuration || 60) * 30),
            };

            console.log(`💾 Saving initial video assets for: ${videoId}`);
            // Insert into shortVideoAssets table first
            await db.insert(shortVideoAssets).values({
                videoId,
                seriesId: seriesData.seriesId,
                videoTitle: scriptData.videoTitle || seriesData.title,
                scriptData: scriptData,
                audioUrl: voiceData.audioUrl,
                audioDuration: voiceData.audioDuration,
                captionData: captionData,
                imageUrls: imageData.imageUrls,
                status: "processing", // Initial status
            });

            // Trigger actual render
            const result = await triggerRender(videoId, props);
            console.log(`🎬 Render triggered (${result.mode} mode) for ${videoId}`);

            return { videoId, mode: result.mode };
        });

        // Update status: saving
        await step.run("update-status-saving", () => updateSeriesStatus(seriesId, "generating:saving"));

        // Step 7: Finalize Series Status
        const saveResult = await step.run("finalize-series", async () => {
            console.log(`🏁 Finalizing series: "${seriesData.title}"`);

            // Update series status to completed
            await db.update(shortVideoSeries)
                .set({ status: "completed", updatedAt: new Date() })
                .where(eq(shortVideoSeries.seriesId, seriesData.seriesId));

            console.log(`✅ Series status updated to completed`);

            return { saved: true, videoId: videoResult.videoId };
        });

        return {
            success: true,
            seriesId,
            scriptData,
            voiceData,
            captionData,
            imageData,
            saveResult,
        };
    }
);
