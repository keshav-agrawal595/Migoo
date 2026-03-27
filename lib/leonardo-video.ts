// ═══════════════════════════════════════════════════════════════════════════════
// Leonardo AI — Kling 2.5 Turbo (Video Generation)
// Text-to-Video & Image-to-Video via Leonardo.AI REST v1 API
// ═══════════════════════════════════════════════════════════════════════════════
import { putWithRotation } from "@/lib/blob";

// ── Kling 2.5 Turbo Configuration ────────────────────────────────────────────
// REST v1 endpoints — avoids the v2 GraphQL-style errors that Seedance had
const IMG2VID_ENDPOINT = "https://cloud.leonardo.ai/api/rest/v1/generations-image-to-video";
const TXT2VID_ENDPOINT = "https://cloud.leonardo.ai/api/rest/v1/generations-text-to-video";
const POLL_ENDPOINT = "https://cloud.leonardo.ai/api/rest/v1/generations";

// Valid durations for Kling 2.5 Turbo (seconds)
const VALID_DURATIONS = [5, 10] as const;

// 9:16 portrait for vertical shorts (1080p)
const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;

// ── Leonardo Key Rotation (up to 10 keys) ─────────────────────────────────────

const LEONARDO_KEY_NAMES = [
    "LEONARDO_API_KEY",
    "LEONARDO_API_KEY1",
    "LEONARDO_API_KEY2",
    "LEONARDO_API_KEY3",
    "LEONARDO_API_KEY4",
    "LEONARDO_API_KEY5",
    "LEONARDO_API_KEY6",
    "LEONARDO_API_KEY7",
    "LEONARDO_API_KEY8",
    "LEONARDO_API_KEY9",
];

/** Load all available Leonardo keys from env */
function getKeys(): string[] {
    return LEONARDO_KEY_NAMES
        .map(name => process.env[name])
        .filter((key): key is string => !!key && key.length > 0);
}

/** Get a shuffled copy of keys for round-robin with randomized start */
function getShuffledKeys(): { key: string; index: number }[] {
    const keys = getKeys();
    if (keys.length === 0) throw new Error("No LEONARDO_API_KEY found in environment variables");
    return keys
        .map((key, index) => ({ key, index, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ key, index }) => ({ key, index }));
}

// ── Upload Image to Leonardo (required for image-to-video) ───────────────────

/**
 * Upload an image URL to Leonardo AI and get an asset ID for use with Kling img2vid.
 * Uses the presigned URL upload flow:
 *   1. POST /api/rest/v1/init-image → get presigned URL + image ID
 *   2. Upload image bytes to presigned URL
 *   3. Return the image ID
 */
async function uploadImageToLeonardo(
    imageUrl: string,
    apiKey: string
): Promise<string> {
    // Download the image
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) throw new Error(`Failed to download image for upload: ${imageRes.status}`);
    const imageBuffer = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get("content-type") || "image/png";
    const ext = contentType.includes("webp") ? "webp" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";

    // Step 1: Init image upload
    const initRes = await fetch("https://cloud.leonardo.ai/api/rest/v1/init-image", {
        method: "POST",
        headers: {
            "accept": "application/json",
            "authorization": `Bearer ${apiKey}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({ extension: ext }),
    });

    if (!initRes.ok) {
        const errText = await initRes.text();
        throw new Error(`Leonardo init-image failed (${initRes.status}): ${errText}`);
    }

    const initData = await initRes.json();
    const uploadUrl = initData?.uploadInitImage?.url;
    const imageId = initData?.uploadInitImage?.id;
    const fields = initData?.uploadInitImage?.fields ? JSON.parse(initData.uploadInitImage.fields) : null;

    if (!uploadUrl || !imageId) {
        throw new Error(`Leonardo init-image response missing url/id: ${JSON.stringify(initData).substring(0, 300)}`);
    }

    // Step 2: Upload image bytes via presigned URL
    if (fields) {
        // Multipart form upload (S3 presigned POST)
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) {
            form.append(key, value as string);
        }
        form.append("file", new Blob([imageBuffer], { type: contentType }), `upload.${ext}`);

        const uploadRes = await fetch(uploadUrl, { method: "POST", body: form });
        if (!uploadRes.ok && uploadRes.status !== 204) {
            const errText = await uploadRes.text();
            throw new Error(`Leonardo image upload failed (${uploadRes.status}): ${errText}`);
        }
    } else {
        // Direct PUT upload
        const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: imageBuffer,
        });
        if (!uploadRes.ok && uploadRes.status !== 200) {
            const errText = await uploadRes.text();
            throw new Error(`Leonardo image upload PUT failed (${uploadRes.status}): ${errText}`);
        }
    }

    console.log(`✅ Image uploaded to Leonardo: ${imageId}`);
    return imageId;
}

// ── Kling 2.5 Turbo Job Submission ───────────────────────────────────────────

/**
 * Clamp duration to nearest valid Kling value (5 or 10 seconds).
 */
function clampDuration(durationSec: number): 5 | 10 {
    return durationSec >= 8 ? 10 : 5;
}

/**
 * Submit a Kling 2.5 Turbo image-to-video job via REST v1 API.
 * Rotates through all available Leonardo API keys.
 */
async function submitKlingImg2VidJob(
    prompt: string,
    duration: 5 | 10,
    imageId: string,
): Promise<{ generationId: string; apiKey: string }> {
    const shuffledKeys = getShuffledKeys();
    const errors: string[] = [];

    for (const { key: apiKey, index: keyIndex } of shuffledKeys) {
        const keyLabel = `Key #${keyIndex + 1}`;
        try {
            console.log(`⏳ Submitting Kling 2.5 Turbo img2vid (${keyLabel})...`);

            const cleanPrompt = prompt.replace(/\s+/g, " ").trim().substring(0, 1490);

            const requestBody = {
                prompt: cleanPrompt,
                imageId,
                imageType: "UPLOADED",
                resolution: "RESOLUTION_1080",
                height: VIDEO_HEIGHT,
                width: VIDEO_WIDTH,
                duration,
                model: "KLING2_5",
                isPublic: false,
            };

            console.log(`📤 Kling img2vid request (${keyLabel}): ${JSON.stringify(requestBody).substring(0, 400)}`);

            const response = await fetch(IMG2VID_ENDPOINT, {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(requestBody),
            });

            if (response.status === 429) {
                console.warn(`⚠️ ${keyLabel} rate-limited (429). Trying next key...`);
                errors.push(`${keyLabel}: Rate limited (429)`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            if (!response.ok) {
                const text = await response.text();
                console.warn(`⚠️ ${keyLabel} failed (${response.status}): ${text}`);
                errors.push(`${keyLabel}: ${response.status} - ${text}`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            const result = await response.json();
            console.log(`📦 Kling img2vid raw response: ${JSON.stringify(result).substring(0, 300)}`);

            // v1 img2vid response: { motionVideoGenerationJob: { generationId: '...' } }
            const generationId =
                result?.motionVideoGenerationJob?.generationId ||
                result?.sdGenerationJob?.generationId ||
                result?.generationId;

            if (!generationId) {
                console.error(`❌ ${keyLabel} — Kling response missing generationId:`, JSON.stringify(result));
                errors.push(`${keyLabel}: Response missing generationId`);
                continue;
            }

            console.log(`✅ Kling img2vid job submitted! ${keyLabel}, id: ${generationId}, duration: ${duration}s`);
            return { generationId, apiKey };
        } catch (e: any) {
            console.warn(`🧨 Error with ${keyLabel}: ${e.message}`);
            errors.push(`${keyLabel}: ${e.message}`);
        }
    }

    throw new Error(`All Leonardo keys failed for Kling img2vid: ${errors.join(", ")}`);
}

/**
 * Submit a Kling 2.5 Turbo text-to-video job via REST v1 API.
 */
async function submitKlingTxt2VidJob(
    prompt: string,
    duration: 5 | 10,
): Promise<{ generationId: string; apiKey: string }> {
    const shuffledKeys = getShuffledKeys();
    const errors: string[] = [];

    for (const { key: apiKey, index: keyIndex } of shuffledKeys) {
        const keyLabel = `Key #${keyIndex + 1}`;
        try {
            console.log(`⏳ Submitting Kling 2.5 Turbo txt2vid (${keyLabel})...`);

            const cleanPrompt = prompt.replace(/\s+/g, " ").trim().substring(0, 1490);

            const requestBody = {
                prompt: cleanPrompt,
                duration,
                model: "KLING2_5",
                height: VIDEO_HEIGHT,
                width: VIDEO_WIDTH,
                resolution: "RESOLUTION_1080",
                isPublic: false,
            };

            console.log(`📤 Kling txt2vid request (${keyLabel}): ${JSON.stringify(requestBody).substring(0, 400)}`);

            const response = await fetch(TXT2VID_ENDPOINT, {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(requestBody),
            });

            if (response.status === 429) {
                console.warn(`⚠️ ${keyLabel} rate-limited (429). Trying next key...`);
                errors.push(`${keyLabel}: Rate limited (429)`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            if (!response.ok) {
                const text = await response.text();
                console.warn(`⚠️ ${keyLabel} failed (${response.status}): ${text}`);
                errors.push(`${keyLabel}: ${response.status} - ${text}`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            const result = await response.json();
            console.log(`📦 Kling txt2vid raw response: ${JSON.stringify(result).substring(0, 300)}`);

            // v1 txt2vid response shape
            const generationId =
                result?.motionVideoGenerationJob?.generationId ||
                result?.sdGenerationJob?.generationId ||
                result?.generationId;

            if (!generationId) {
                console.error(`❌ ${keyLabel} — Kling txt2vid response missing generationId:`, JSON.stringify(result));
                errors.push(`${keyLabel}: Response missing generationId`);
                continue;
            }

            console.log(`✅ Kling txt2vid job submitted! ${keyLabel}, id: ${generationId}, duration: ${duration}s`);
            return { generationId, apiKey };
        } catch (e: any) {
            console.warn(`🧨 Error with ${keyLabel}: ${e.message}`);
            errors.push(`${keyLabel}: ${e.message}`);
        }
    }

    throw new Error(`All Leonardo keys failed for Kling txt2vid: ${errors.join(", ")}`);
}

// ── Poll for Kling Result ────────────────────────────────────────────────────

/**
 * Poll Leonardo v1 status endpoint for a generation result.
 */
async function pollKlingJob(
    generationId: string,
    apiKey: string,
    maxAttempts: number = 300 // ~15 minutes at 3s intervals
): Promise<{ url: string; type: "video" | "image" }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3s intervals

        try {
            const statusResponse = await fetch(
                `${POLL_ENDPOINT}/${generationId}`,
                {
                    headers: {
                        "accept": "application/json",
                        "authorization": `Bearer ${apiKey}`,
                    },
                }
            );

            if (statusResponse.status === 429) {
                console.warn(`⚠️ Kling polling rate-limited, waiting extra time...`);
                await new Promise(resolve => setTimeout(resolve, 8000));
                continue;
            }

            if (!statusResponse.ok) {
                const errorText = await statusResponse.text();
                // 404 early on is normal for video jobs that take time to register
                if (statusResponse.status === 404 && attempt < 10) {
                    console.log(`  [Poll #${attempt + 1}] Job not registered yet (404)...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                throw new Error(`Kling status check failed (${statusResponse.status}): ${errorText}`);
            }

            const statusResult = await statusResponse.json();
            const generation = statusResult?.generations_by_pk;
            const status = generation?.status;

            if (attempt % 5 === 0) {
                console.log(`  [Poll #${attempt + 1}] Kling: status = ${status}`);
            }

            if (status === "COMPLETE") {
                // Check for video output first, then image
                const videos = generation?.generated_images?.filter((i: any) => i.motionMP4URL);
                if (videos && videos.length > 0) {
                    return { url: videos[0].motionMP4URL, type: "video" };
                }

                // Fallback to regular image URL
                const images = generation?.generated_images;
                if (images && images.length > 0) {
                    const videoUrl = images[0].motionMP4URL || images[0].url;
                    return { url: videoUrl, type: images[0].motionMP4URL ? "video" : "image" };
                }

                throw new Error(`Kling job complete but no output found: ${JSON.stringify(statusResult).substring(0, 500)}`);
            }

            if (status === "FAILED") {
                throw new Error(`Kling job failed: ${JSON.stringify(statusResult).substring(0, 500)}`);
            }

        } catch (error: any) {
            if (error.message.includes("429")) {
                await new Promise(resolve => setTimeout(resolve, 8000));
                continue;
            }
            throw error;
        }
    }

    throw new Error(`Kling job ${generationId} timed out after ${maxAttempts} poll attempts`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a video from an image using Kling 2.5 Turbo (Image-to-Video).
 * Uploads the image to Leonardo → submits Kling job → polls → persists to Blob.
 *
 * @param imageUrl      - URL of the source image
 * @param videoPrompt   - Description of how the image should animate
 * @param durationSec   - Desired duration in seconds (will be clamped to 5 or 10)
 * @param seriesId      - Series ID for file organization
 * @param sceneIndex    - Scene index for file naming
 * @returns             - { videoUrl, thumbnailUrl, actualDurationSec }
 */
export async function generateLeonardoVideo(
    imageUrl: string,
    videoPrompt: string,
    durationSec: number,
    seriesId: string,
    sceneIndex: number
): Promise<{ videoUrl: string; thumbnailUrl: string; actualDurationSec: number }> {
    const duration = clampDuration(durationSec);

    console.log(`🎬 Kling 2.5 Turbo img2vid: Scene ${sceneIndex + 1} | ${VIDEO_WIDTH}x${VIDEO_HEIGHT} | ${duration}s`);
    console.log(`   Prompt: "${videoPrompt.substring(0, 100)}..."`);

    // Step 1: Upload image to Leonardo to get asset ID
    const uploadKey = getShuffledKeys()[0].key;
    const imageId = await uploadImageToLeonardo(imageUrl, uploadKey);

    // Step 2: Submit Kling job with image
    const { generationId, apiKey } = await submitKlingImg2VidJob(videoPrompt, duration, imageId);

    // Step 3: Poll for result
    const result = await pollKlingJob(generationId, apiKey);
    console.log(`✅ Kling video ready: ${result.url.substring(0, 80)}...`);

    // Step 4: Download and upload to Vercel Blob for permanent storage
    const videoRes = await fetch(result.url);
    if (!videoRes.ok) throw new Error(`Failed to download Kling video: ${videoRes.status}`);

    const videoBuffer = await videoRes.arrayBuffer();
    const filename = `shorts/${seriesId}/scene_${sceneIndex}_kling_${Date.now()}.mp4`;

    const blob = await putWithRotation(filename, videoBuffer, {
        access: "public",
        contentType: "video/mp4",
        addRandomSuffix: false,
    });

    console.log(`✅ Scene ${sceneIndex + 1} Kling video uploaded: ${blob.url}`);

    return {
        videoUrl: blob.url,
        thumbnailUrl: imageUrl || "",
        actualDurationSec: duration,
    };
}

/**
 * Generate a video from text only (no source image) using Kling 2.5 Turbo.
 *
 * @param prompt        - Text description for the video
 * @param durationSec   - Desired duration in seconds (will be clamped to 5 or 10)
 * @param seriesId      - Series ID for file organization
 * @param sceneIndex    - Scene index for file naming
 * @returns             - { videoUrl, thumbnailUrl, actualDurationSec }
 */
export async function generateLeonardoTextVideo(
    prompt: string,
    durationSec: number,
    seriesId: string,
    sceneIndex: number
): Promise<{ videoUrl: string; thumbnailUrl: string; actualDurationSec: number }> {
    const duration = clampDuration(durationSec);

    console.log(`🎬 Kling 2.5 Turbo txt2vid: Scene ${sceneIndex + 1} | ${VIDEO_WIDTH}x${VIDEO_HEIGHT} | ${duration}s`);

    // Submit Kling text-to-video job
    const { generationId, apiKey } = await submitKlingTxt2VidJob(prompt, duration);

    // Poll for result
    const result = await pollKlingJob(generationId, apiKey);
    console.log(`✅ Kling text video ready: ${result.url.substring(0, 80)}...`);

    // Download and upload to Vercel Blob
    const videoRes = await fetch(result.url);
    if (!videoRes.ok) throw new Error(`Failed to download Kling video: ${videoRes.status}`);

    const videoBuffer = await videoRes.arrayBuffer();
    const filename = `shorts/${seriesId}/scene_${sceneIndex}_kling_txt_${Date.now()}.mp4`;

    const blob = await putWithRotation(filename, videoBuffer, {
        access: "public",
        contentType: "video/mp4",
        addRandomSuffix: false,
    });

    console.log(`✅ Scene ${sceneIndex + 1} Kling text video uploaded: ${blob.url}`);

    return {
        videoUrl: blob.url,
        thumbnailUrl: "",
        actualDurationSec: duration,
    };
}
