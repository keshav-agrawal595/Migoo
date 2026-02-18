// ═══════════════════════════════════════════════════════════════════════════════
// DeAPI Client — Automatic Key Rotation on Rate Limits (429)
// ═══════════════════════════════════════════════════════════════════════════════

const DEAPI_KEY_NAMES = [
    "DEAPI_API_KEY",
    "DEAPI_API_KEY2",
    "DEAPI_API_KEY3",
    "DEAPI_API_KEY4",
    "DEAPI_API_KEY5",
    "DEAPI_API_KEY6",
];

/** Load all available DeAPI keys from env */
function getKeys(): string[] {
    return DEAPI_KEY_NAMES
        .map(name => process.env[name])
        .filter((key): key is string => !!key && key.length > 0);
}

/** Track which key index to use next (round-robin) */
let currentKeyIndex = 0;

/** Get the next available API key */
function getNextKey(): string {
    const keys = getKeys();
    if (keys.length === 0) {
        throw new Error("No DEAPI_API_KEY found in environment variables");
    }
    const key = keys[currentKeyIndex % keys.length];
    return key;
}

/** Rotate to the next key */
function rotateKey(): void {
    const keys = getKeys();
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    console.log(`🔄 Rotated to DeAPI key #${(currentKeyIndex % keys.length) + 1} of ${keys.length}`);
}

/**
 * Submit a txt2img job to DeAPI with automatic key rotation on 429.
 * Tries every key once before giving up.
 */
export async function submitDeAPIJob(prompt: string, width: number, height: number, steps: number): Promise<string> {
    const keys = getKeys();
    const maxRetries = keys.length;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const apiKey = getNextKey();
        const keyNum = (currentKeyIndex % keys.length) + 1;

        try {
            const response = await fetch("https://api.deapi.ai/api/v1/client/txt2img", {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    prompt,
                    model: "Flux1schnell",
                    width,
                    height,
                    guidance: 7.5,
                    steps,
                    seed: Math.floor(Math.random() * 999999),
                    negative_prompt: "blur, darkness, noise, low quality, distorted text, unreadable"
                })
            });

            if (response.status === 429) {
                console.warn(`⚠️ Key #${keyNum} rate-limited (429). Rotating...`);
                rotateKey();
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`DeAPI txt2img failed (${response.status}): ${errorText}`);
            }

            const submitResult = await response.json();
            const requestId = submitResult.data?.request_id;

            if (!requestId) {
                throw new Error(`DeAPI returned no request_id. Response: ${JSON.stringify(submitResult)}`);
            }

            console.log(`⏳ DeAPI job submitted with key #${keyNum}, request_id: ${requestId}`);

            // After successful submission, rotate to next key for next call
            // This distributes load across keys proactively
            rotateKey();

            return requestId;

        } catch (error: any) {
            if (error.message.includes("429") || error.message.includes("Too Many Attempts")) {
                console.warn(`⚠️ Key #${keyNum} rate-limited. Rotating...`);
                rotateKey();
                continue;
            }
            throw error;
        }
    }

    throw new Error(`All ${maxRetries} DeAPI keys are rate-limited. Please wait and try again.`);
}

/**
 * Poll for a DeAPI job result until done.
 * Uses the current key for polling (auto-rotates on 429 during polling too).
 */
export async function pollDeAPIJob(requestId: string, maxAttempts: number = 60): Promise<string> {
    const keys = getKeys();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const apiKey = getNextKey();

        try {
            const statusResponse = await fetch(`https://api.deapi.ai/api/v1/client/request-status/${requestId}`, {
                headers: {
                    "Accept": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                }
            });

            if (statusResponse.status === 429) {
                console.warn(`⚠️ Polling rate-limited, rotating key...`);
                rotateKey();
                continue;
            }

            if (!statusResponse.ok) {
                const errorText = await statusResponse.text();
                throw new Error(`DeAPI status check failed (${statusResponse.status}): ${errorText}`);
            }

            const statusResult = await statusResponse.json();
            const status = statusResult.data?.status || statusResult.status;

            if (attempt % 3 === 0) {
                console.log(`  Poll #${attempt + 1}: status = ${status}`);
            }

            if (status === "done" || status === "completed") {
                const imageUrl = statusResult.data?.result_url;
                if (!imageUrl) {
                    console.log("📸 Full status response:", JSON.stringify(statusResult).substring(0, 500));
                    throw new Error(`DeAPI job done but no result_url found. Keys: ${Object.keys(statusResult.data || {})}`);
                }
                return imageUrl;
            }

            if (status === "error" || status === "failed") {
                throw new Error(`DeAPI job failed: ${JSON.stringify(statusResult)}`);
            }

        } catch (error: any) {
            if (error.message.includes("429")) {
                rotateKey();
                continue;
            }
            throw error;
        }
    }

    throw new Error(`DeAPI job ${requestId} timed out after ${maxAttempts} poll attempts`);
}

/**
 * Generate an image using DeAPI with full key rotation support.
 * Submit job → poll for result → return full-res URL.
 */
export async function generateDeAPIImage(prompt: string, width: number = 768, height: number = 432, steps: number = 4): Promise<string> {
    const requestId = await submitDeAPIJob(prompt, width, height, steps);
    const imageUrl = await pollDeAPIJob(requestId);
    return imageUrl;
}
