import { db } from "@/config/db";
import { openrouter } from "@/config/openrouter";
import { shortVideoSeries, shortVideoAssets } from "@/config/schema";
import { putWithRotation, getBlobToken } from "@/lib/blob";
import { generateNanoBananaImage, NANO_BANANA_STYLES } from "@/lib/leonardo";
import { getMusicUrl } from "@/lib/music-urls";
import { eq, and, or } from "drizzle-orm";
import { inngest } from "./client";
import { triggerRender } from "@/lib/video-render";

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
        const { seriesId } = event.data;

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

        // Step 2: Generate Video Script using AI
        const scriptData = await step.run("generate-video-script", async () => {
            console.log(`📝 Generating video script for: "${seriesData.title}"`);

            const isShort = seriesData.duration === "30-40";
            const sceneCount = isShort ? 5 : 6;
            const durationLabel = isShort ? "30-40 seconds" : "60-70 seconds";

            // ── Word-count math ──────────────────────────────────────
            // Sarvam TTS at 1.05× pace ≈ 2.5 words/sec (150 WPM)
            const WORDS_PER_SEC = 2.5;
            const targetMinSec = isShort ? 30 : 60;
            const targetMaxSec = isShort ? 40 : 70;
            const totalWordsMin = Math.ceil(targetMinSec * WORDS_PER_SEC);   // 75 or 150
            const totalWordsMax = Math.ceil(targetMaxSec * WORDS_PER_SEC);   // 100 or 175
            const perSceneWordsMin = Math.ceil(totalWordsMin / sceneCount);   // ~15 or ~25
            const perSceneWordsMax = Math.ceil(totalWordsMax / sceneCount);   // ~20 or ~29
            // ─────────────────────────────────────────────────────────

            const systemPrompt = `You are an expert short-form video scriptwriter. You create viral, engaging scripts for platforms like YouTube Shorts, Instagram Reels, and TikTok. Your scripts sound natural and conversational — perfect for voiceover narration. You always respond in pure JSON only.

CRITICAL RULE: Write the 'narration' text ENTIRELY in ${seriesData.language === 'en-IN' ? 'English' : 'the target language script (e.g., Hindi, Punjabi) as requested'}. The voiceover MUST be in the script of the selected language.

CRITICAL RULE: The narration text you write will be converted to speech using a TTS engine that speaks at approximately 2.5 words per second. You MUST write enough words to fill the requested duration. Count your words carefully.`;

            const userPrompt = `Create a short video script for the following:

- **Niche/Topic**: ${seriesData.niche}
- **Series Title**: ${seriesData.title}
- **Video Style**: ${seriesData.videoStyle}
- **Target Duration**: ${durationLabel}
- **Platform**: ${seriesData.platform}
- **Language**: ${seriesData.language} (Write narration ENTIRELY in this language's script)

═══ WORD COUNT REQUIREMENTS (VERY IMPORTANT) ═══
The TTS engine speaks at ~2.5 words per second. To fill ${durationLabel}, you MUST write:
• TOTAL narration across ALL scenes: ${totalWordsMin} to ${totalWordsMax} words
• EACH scene narration: ${perSceneWordsMin} to ${perSceneWordsMax} words minimum
• Number of scenes: exactly ${sceneCount}

If the total word count falls below ${totalWordsMin} words, the video will be TOO SHORT.
Write detailed, descriptive, engaging narration — NOT brief bullet points.
═══════════════════════════════════════════════════

REQUIREMENTS:
1. Write a catchy, attention-grabbing **videoTitle** for this specific video.
2. Write a natural, conversational narration that sounds great when spoken aloud. Use dramatic pauses (with commas and ellipses), rhetorical questions, hooks, and storytelling flow. Avoid robotic or overly formal language.
3. Create exactly **${sceneCount} scenes**. Each scene MUST have:
   - "sceneNumber": the scene index (1, 2, 3, ...)
   - "narration": the voiceover text for this scene (${perSceneWordsMin}-${perSceneWordsMax} words MINIMUM per scene)
   - "imagePrompt": a detailed, vivid image generation prompt (40-60 words) matching the "${seriesData.videoStyle}" style. Use specific architectural terms, atmospheric lighting, and accurate historical details (e.g., if mentioning the Golden Temple, describe the specific marble, gold plating, and Amrit Sarovar lake accurately). Be specific about colors, composition, mood, and lighting.
   - "duration": estimated seconds for this scene when spoken at 2.5 words/sec
   - "wordCount": the exact word count of the narration text for this scene
4. Include a "totalWordCount" field with the sum of all scene word counts.

IMPORTANT:
- The total word count MUST be between ${totalWordsMin} and ${totalWordsMax}.
- Each scene's "duration" should equal its wordCount / 2.5 (rounded to nearest integer).
- The script must hook the viewer in the first 2 seconds.
- Return ONLY valid JSON, no markdown, no extra text.

Return the response in this exact JSON format:
{
  "videoTitle": "Catchy Video Title Here",
  "totalScenes": ${sceneCount},
  "totalWordCount": ${totalWordsMin},
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "Write a long, detailed, natural voiceover narration here with at least ${perSceneWordsMin} words...",
      "imagePrompt": "Detailed image description for AI generation...",
      "duration": ${Math.round(perSceneWordsMin / WORDS_PER_SEC)},
      "wordCount": ${perSceneWordsMin}
    }
  ]
}`;

            // ── Generate with validation + retry ─────────────────────
            const MAX_ATTEMPTS = 2;
            let bestResult: any = null;
            let bestWordCount = 0;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                console.log(`🔄 Script generation attempt ${attempt}/${MAX_ATTEMPTS}...`);

                const result = await openrouter.json(systemPrompt, userPrompt, {
                    model: "arcee-ai/trinity-large-preview:free",
                    temperature: attempt === 1 ? 0.8 : 0.9,
                    maxTokens: 5000,
                });

                // Count actual words across all scenes
                const actualWordCount = result.scenes?.reduce(
                    (sum: number, s: any) => sum + (s.narration?.split(/\s+/).length || 0),
                    0
                ) || 0;

                console.log(`📊 Attempt ${attempt}: ${actualWordCount} words (target: ${totalWordsMin}-${totalWordsMax}), ${result.scenes?.length} scenes`);

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

            console.log(`✅ Script finalized: "${bestResult.videoTitle}" | ${bestResult.scenes?.length} scenes | ${bestWordCount} words ≈ ${Math.round(bestWordCount / WORDS_PER_SEC)}s`);
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
                try { fs.unlinkSync(tempFilePath); } catch {}
                console.error(`❌ Sarvam Batch STT Error: ${error.message}`);
                throw error;
            }
        });

        // Update status: generating images
        await step.run("update-status-images", () => updateSeriesStatus(seriesId, "generating:images"));

        // Step 5: Generate Images using Leonardo Nano Banana 2
        const imageData = await step.run("generate-images", async () => {
            console.log(`🖼️ Generating images for: "${seriesData.title}"`);
            console.log(`📸 Scenes to generate: ${scriptData.scenes?.length}`);

            // Map video style to a Leonardo style UUID
            const styleMap: Record<string, string> = {
                "cinematic": NANO_BANANA_STYLES["Portrait Cinematic"],
                "realistic": NANO_BANANA_STYLES["Stock Photo"],
                "anime": NANO_BANANA_STYLES["Creative"],
                "3d": NANO_BANANA_STYLES["3D Render"],
                "watercolor": NANO_BANANA_STYLES["Watercolor"],
                "comic": NANO_BANANA_STYLES["Illustration"],
                "minimal": NANO_BANANA_STYLES["Creative"],
                "neon": NANO_BANANA_STYLES["Dynamic"],
                "vintage": NANO_BANANA_STYLES["Portrait Fashion"],
                "dark": NANO_BANANA_STYLES["Portrait Cinematic"],
            };

            const videoStyleLower = (seriesData.videoStyle || "").toLowerCase();
            const selectedStyle = styleMap[videoStyleLower] || NANO_BANANA_STYLES["Dynamic"];
            console.log(`🎨 Style: ${seriesData.videoStyle} → ${selectedStyle}`);

            // Generate images sequentially (one per scene) with rate-limiting
            // Portrait dimensions for vertical shorts: 768×1376 (smallest = cheapest)
            const imageUrls: string[] = [];

            for (let i = 0; i < scriptData.scenes.length; i++) {
                const scene = scriptData.scenes[i];
                const prompt = scene.imagePrompt;

                console.log(`🖼️ Scene ${i + 1}/${scriptData.scenes.length}: "${prompt.substring(0, 80)}..."`);

                try {
                    const imageUrl = await generateNanoBananaImage(
                        prompt,
                        768,    // width (portrait for shorts)
                        1376,   // height
                        selectedStyle
                    );
                    imageUrls.push(imageUrl);
                    console.log(`✅ Scene ${i + 1} image: ${imageUrl.substring(0, 60)}...`);
                } catch (err: any) {
                    console.error(`❌ Scene ${i + 1} image FAILED — Full error below:`);
                    console.error(err?.message || err);
                    // Do NOT swallow silently — surface the real error in Inngest logs
                    imageUrls.push(""); // push empty so indices stay aligned
                }

                // Rate-limit between generations (avoid hitting Leonardo limits)
                if (i < scriptData.scenes.length - 1) {
                    const delay = 3000 + Math.random() * 2000; // 3-5s
                    console.log(`⏳ Waiting ${Math.round(delay)}ms before next image...`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }

            const successCount = imageUrls.filter(u => u.length > 0).length;
            console.log(`✅ Generated ${successCount}/${scriptData.scenes.length} images`);

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
