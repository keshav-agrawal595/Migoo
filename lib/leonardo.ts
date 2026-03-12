// ═══════════════════════════════════════════════════════════════════════════════
// Leonardo AI Client — FLUX Schnell with Automatic Key Rotation
// ═══════════════════════════════════════════════════════════════════════════════

const LEONARDO_KEY_NAMES = [
    "LEONARDO_API_KEY",
    "LEONARDO_API_KEY2",
    "LEONARDO_API_KEY3",
    "LEONARDO_API_KEY4",
    "LEONARDO_API_KEY5",
    "LEONARDO_API_KEY6",
];

const FLUX_SCHNELL_MODEL_ID = "1dd50843-d653-4516-a8e3-f0238ee453ff";

export const LEONARDO_STYLES = {
    "3D Render": "debdf72a-91a4-467b-bf61-cc02bdeb69c6",
    "Acrylic": "3cbb655a-7ca4-463f-b697-8a03ad67327c",
    "Anime General": "b2a54a51-230b-4d4f-ad4e-8409bf58645f",
    "Creative": "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
    "Dynamic": "111dc692-d470-4eec-b791-3475abac4c46",
    "Fashion": "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
    "Game Concept": "09d2b5b5-d7c5-4c02-905d-9f84051640f4",
    "Graphic Design 3D": "7d7c2bc5-4b12-4ac3-81a9-630057e9e89f",
    "Illustration": "645e4195-f63d-4715-a3f2-3fb1e6eb8c70",
    "None": "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
    "Portrait": "8e2bc543-6ee2-45f9-bcd9-594b6ce84dcd",
    "Portrait Cinematic": "4edb03c9-8a26-4041-9d01-f85b5d4abd71",
    "Ray Traced": "b504f83c-3326-4947-82e1-7fe9e839ec0f",
    "Stock Photo": "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
    "Watercolor": "1db308ce-c7ad-4d10-96fd-592fa6b75cc4"
};

const DEFAULT_STYLE_UUID = LEONARDO_STYLES["Dynamic"];

/** Load all available Leonardo keys from env */
function getKeys(): string[] {
    return LEONARDO_KEY_NAMES
        .map(name => process.env[name])
        .filter((key): key is string => !!key && key.length > 0);
}

/**
 * Submit a generation job to Leonardo AI with randomized key shuffling.
 * Returns the generationId AND the key used (so polling uses the same key).
 */
async function submitLeonardoJob(
    prompt: string,
    width: number,
    height: number,
    styleUUID?: string
): Promise<{ generationId: string; apiKey: string }> {
    const allKeys = getKeys();
    if (allKeys.length === 0) {
        throw new Error("No LEONARDO_API_KEY found in environment variables");
    }

    // Create a shuffled copy of the keys to try them in random order
    const shuffledKeys = [...allKeys]
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

    const errors: string[] = [];

    for (let i = 0; i < shuffledKeys.length; i++) {
        const apiKey = shuffledKeys[i];
        const keyIndex = allKeys.indexOf(apiKey); // Original index for logging

        try {
            console.log(`⏳ Submitting Leonardo job using shuffled key #${keyIndex + 1}/${allKeys.length}...`);
            const response = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    modelId: FLUX_SCHNELL_MODEL_ID,
                    prompt,
                    width,
                    height,
                    num_images: 1,
                    contrast: 1.0,
                    styleUUID: styleUUID || DEFAULT_STYLE_UUID,
                    enhancePrompt: false
                })
            });

            if (response.status === 429) {
                console.warn(`⚠️ Leonardo key #${keyIndex + 1} rate-limited (429). Trying another shuffled key...`);
                errors.push(`Key #${keyIndex + 1}: Rate limited (429)`);
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`⚠️ Leonardo key #${keyIndex + 1} failed (${response.status}): ${errorText}`);
                errors.push(`Key #${keyIndex + 1}: ${response.status} - ${errorText}`);
                continue;
            }

            const result = await response.json();
            const generationId = result?.sdGenerationJob?.generationId;

            if (!generationId) {
                throw new Error(`Leonardo returned no generationId. Response: ${JSON.stringify(result)}`);
            }

            console.log(`✅ Leonardo job submitted! key: #${keyIndex + 1}, id: ${generationId}`);
            return { generationId, apiKey };

        } catch (error: any) {
            console.warn(`🧨 Error with Leonardo key #${keyIndex + 1}: ${error.message}`);
            errors.push(`Key #${keyIndex + 1}: ${error.message}`);
            continue;
        }
    }

    throw new Error(`All ${allKeys.length} Leonardo keys failed:\n${errors.join("\n")}`);
}

/**
 * Poll for a Leonardo generation result until done.
 * Uses the SAME key that submitted the job.
 */
async function pollLeonardoJob(generationId: string, apiKey: string, maxAttempts: number = 60): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
            const statusResponse = await fetch(
                `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`,
                {
                    headers: {
                        "accept": "application/json",
                        "authorization": `Bearer ${apiKey}`
                    }
                }
            );

            if (statusResponse.status === 429) {
                console.warn(`⚠️ Leonardo polling rate-limited, waiting extra time...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            if (!statusResponse.ok) {
                const errorText = await statusResponse.text();
                throw new Error(`Leonardo status check failed (${statusResponse.status}): ${errorText}`);
            }

            const statusResult = await statusResponse.json();
            const generation = statusResult?.generations_by_pk;
            const status = generation?.status;

            if (attempt % 3 === 0) {
                console.log(`  Poll #${attempt + 1}: status = ${status}`);
            }

            if (status === "COMPLETE") {
                const images = generation?.generated_images;
                if (!images || images.length === 0) {
                    throw new Error(`Leonardo job complete but no images found. Response: ${JSON.stringify(statusResult).substring(0, 500)}`);
                }
                const imageUrl = images[0].url;
                if (!imageUrl) {
                    throw new Error(`Leonardo job complete but no URL in image. Keys: ${Object.keys(images[0])}`);
                }
                return imageUrl;
            }

            if (status === "FAILED") {
                throw new Error(`Leonardo job failed: ${JSON.stringify(statusResult)}`);
            }

        } catch (error: any) {
            if (error.message.includes("429")) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }
            throw error;
        }
    }

    throw new Error(`Leonardo job ${generationId} timed out after ${maxAttempts} poll attempts`);
}

/**
 * Generate an image using Leonardo AI FLUX Schnell with full key rotation.
 * Submit job → poll for result → return image URL.
 */
export async function generateLeonardoImage(
    prompt: string,
    width: number = 768,
    height: number = 432,
    styleUUID?: string
): Promise<string> {
    const { generationId, apiKey } = await submitLeonardoJob(prompt, width, height, styleUUID);
    const imageUrl = await pollLeonardoJob(generationId, apiKey);
    return imageUrl;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lucid Origin — High-quality image generation for Short Videos
// ═══════════════════════════════════════════════════════════════════════════════

const LUCID_ORIGIN_MODEL_ID = "7b592283-e8a7-4c5a-9ba6-d18c31f258b9";

export const LUCID_ORIGIN_STYLES: Record<string, string> = {
    "Bokeh": "9fdc5e8c-4d13-49b4-9ce6-5a74cbb19177",
    "Cinematic": "a5632c7c-ddbb-4e2f-ba34-8456ab3ac436",
    "Cinematic Close-Up": "cc53f935-884c-40a0-b7eb-1f5c42821fb5",
    "Creative": "6fedbf1f-4a17-45ec-84fb-92fe524a29ef",
    "Dynamic": "111dc692-d470-4eec-b791-3475abac4c46",
    "Fashion": "594c4a08-a522-4e0e-b7ff-e4dac4b6b622",
    "Film": "85da2dcc-c373-464c-9a7a-5624359be859",
    "Food": "d574325d-1278-4fe2-974b-768525f253c3",
    "HDR": "97c20e5c-1af6-4d42-b227-54d03d8f0727",
    "Long Exposure": "335e6010-a75c-45d9-afc5-032c65e9180e",
    "Macro": "30c1d34f-e3a9-479a-b56f-c018bbc9c02a",
    "Minimalist": "cadc8cd6-7838-4c99-b645-df76be8ba8d8",
    "Monochrome": "a2f7ea66-959b-4bbe-b508-6133238b76b6",
    "Moody": "621e1c9a-6319-4bee-a12d-ae40659162fa",
    "Neutral": "0d914779-c822-430a-b976-30075033f1c4",
    "None": "556c1ee5-ec38-42e8-955a-1e82dad0ffa1",
    "Portrait": "8e2bc543-6ee2-45f9-bcd9-594b6ce84dcd",
    "Retro": "6105baa2-851b-446e-9db5-08a671a8c42f",
    "Stock Photo": "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c",
    "Unprocessed": "62736842-6e4b-4028-b79a-4f1a1606e893",
    "Vibrant": "dee282d3-891f-4f73-ba02-7f8131e5541b",
};

/**
 * Submit a Lucid Origin generation job with key rotation.
 * Uses contrast parameter (required for Lucid Origin) and no alchemy.
 */
async function submitLucidOriginJob(
    prompt: string,
    width: number,
    height: number,
    styleUUID?: string,
    contrast: number = 3.5
): Promise<{ generationId: string; apiKey: string }> {
    const allKeys = getKeys();
    if (allKeys.length === 0) {
        throw new Error("No LEONARDO_API_KEY found in environment variables");
    }

    const shuffledKeys = [...allKeys]
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

    const errors: string[] = [];

    for (let i = 0; i < shuffledKeys.length; i++) {
        const apiKey = shuffledKeys[i];
        const keyIndex = allKeys.indexOf(apiKey);

        try {
            console.log(`⏳ Submitting Lucid Origin job using key #${keyIndex + 1}/${allKeys.length}...`);
            const response = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "authorization": `Bearer ${apiKey}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    modelId: LUCID_ORIGIN_MODEL_ID,
                    prompt,
                    width,
                    height,
                    num_images: 1,
                    contrast,
                    alchemy: false,
                    ultra: false,
                    styleUUID: styleUUID || LUCID_ORIGIN_STYLES["Dynamic"],
                    enhancePrompt: false,
                })
            });

            if (response.status === 429) {
                console.warn(`⚠️ Lucid Origin key #${keyIndex + 1} rate-limited (429). Trying next...`);
                errors.push(`Key #${keyIndex + 1}: Rate limited (429)`);
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`⚠️ Lucid Origin key #${keyIndex + 1} failed (${response.status}): ${errorText}`);
                errors.push(`Key #${keyIndex + 1}: ${response.status} - ${errorText}`);
                continue;
            }

            const result = await response.json();
            const generationId = result?.sdGenerationJob?.generationId;

            if (!generationId) {
                throw new Error(`Lucid Origin returned no generationId: ${JSON.stringify(result)}`);
            }

            console.log(`✅ Lucid Origin job submitted! key: #${keyIndex + 1}, id: ${generationId}`);
            return { generationId, apiKey };

        } catch (error: any) {
            console.warn(`🧨 Error with key #${keyIndex + 1}: ${error.message}`);
            errors.push(`Key #${keyIndex + 1}: ${error.message}`);
            continue;
        }
    }

    throw new Error(`All ${allKeys.length} Leonardo keys failed:\n${errors.join("\n")}`);
}

/**
 * Generate an image using Lucid Origin (HD, high-quality) with full key rotation.
 * Best for short video scene images with detailed prompts.
 *
 * Default: portrait 768×1376 for vertical shorts (9:16)
 * Cost: ~$0.012 per image at smallest size
 */
export async function generateLucidOriginImage(
    prompt: string,
    width: number = 768,
    height: number = 1376,
    styleUUID?: string,
    contrast: number = 3.5
): Promise<string> {
    const { generationId, apiKey } = await submitLucidOriginJob(prompt, width, height, styleUUID, contrast);
    const imageUrl = await pollLeonardoJob(generationId, apiKey);
    return imageUrl;
}
