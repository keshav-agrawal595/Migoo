// ═══════════════════════════════════════════════════════════════════════════════
// RunwayML Text-to-Image — Gemini 2.5 Flash with Automatic Key Rotation
// ═══════════════════════════════════════════════════════════════════════════════

const RUNWAY_KEY_NAMES = [
    "RUNWAY_API_KEY",
    "RUNWAY_API_KEY2",
    "RUNWAY_API_KEY3",
    "RUNWAY_API_KEY4",
    "RUNWAY_API_KEY5",
    "RUNWAY_API_KEY6",
    "RUNWAY_API_KEY7",
    "RUNWAY_API_KEY8",
    "RUNWAY_API_KEY9",
    "RUNWAY_API_KEY10",
    "RUNWAY_API_KEY11",
    "RUNWAY_API_KEY12",
    "RUNWAY_API_KEY13",
    "RUNWAY_API_KEY14",
    "RUNWAY_API_KEY15",
];

const RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_API_VERSION = "2024-11-06";
const RUNWAY_MODEL = "gemini_2.5_flash";

/** Load all available RunwayML keys from env */
function getKeys(): string[] {
    return RUNWAY_KEY_NAMES
        .map(name => process.env[name])
        .filter((key): key is string => !!key && key.length > 0);
}

/**
 * Submit a text-to-image task to RunwayML with randomized key shuffling.
 * Returns the task ID and the key used (so polling uses the same key).
 */
async function submitRunwayTask(
    prompt: string,
    ratio: string,
    apiKey: string
): Promise<string> {
    const response = await fetch(`${RUNWAY_API_BASE}/text_to_image`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "X-Runway-Version": RUNWAY_API_VERSION,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: RUNWAY_MODEL,
            promptText: prompt,
            ratio,
            contentModeration: {
                publicFigureThreshold: "low"
            },
        }),
    });

    if (response.status === 429) {
        throw new RateLimitError("Rate limited (429)");
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RunwayML API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    const taskId = result?.id;

    if (!taskId) {
        throw new Error(`RunwayML returned no task ID. Response: ${JSON.stringify(result)}`);
    }

    return taskId;
}

/**
 * Poll a RunwayML task until it completes and return the output image URL.
 */
async function pollRunwayTask(
    taskId: string,
    apiKey: string,
    maxAttempts: number = 120
): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
            const response = await fetch(`${RUNWAY_API_BASE}/tasks/${taskId}`, {
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "X-Runway-Version": RUNWAY_API_VERSION,
                },
            });

            if (response.status === 429) {
                console.warn(`⚠️ RunwayML polling rate-limited, waiting extra time...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`RunwayML task poll failed (${response.status}): ${errorText}`);
            }

            const task = await response.json();
            const status = task?.status;

            if (attempt % 5 === 0) {
                console.log(`  Poll #${attempt + 1}: status = ${status}`);
            }

            if (status === "SUCCEEDED") {
                // The output field contains the image URL(s)
                const outputUrl =
                    task?.output?.[0] ||       // Array of URLs
                    task?.outputUrl ||          // Single URL field
                    task?.output?.url ||        // Nested object
                    task?.artifactUrl;          // Alternative field

                if (!outputUrl) {
                    throw new Error(`RunwayML task succeeded but no output URL found. Response: ${JSON.stringify(task).substring(0, 500)}`);
                }

                return outputUrl;
            }

            if (status === "FAILED" || status === "CANCELLED") {
                const failReason = task?.failureReason || task?.failure || task?.error || "Unknown reason";
                const failMsg = `RunwayML task ${status}: ${failReason}`;
                // Detect content moderation or generation failures — treat both as moderation issues
                if (typeof failReason === "string" && (failReason.toLowerCase().includes("content") || failReason.toLowerCase().includes("failed to generate"))) {
                    throw new ContentModerationError(failMsg);
                }
                throw new Error(failMsg);
            }

            // Status is PENDING, PROCESSING, RUNNING, etc. — continue polling

        } catch (error: any) {
            if (error.message.includes("429")) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }
            throw error;
        }
    }

    throw new Error(`RunwayML task ${taskId} timed out after ${maxAttempts} poll attempts`);
}

/** Custom error class for rate limiting (to trigger key rotation) */
class RateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RateLimitError";
    }
}

/** Custom error class for content moderation failures */
export class ContentModerationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ContentModerationError";
    }
}

/**
 * Generate an image using RunwayML Gemini 2.5 Flash with full key rotation.
 *
 * @param prompt  - The image generation prompt
 * @param ratio   - Aspect ratio string, e.g. "1024:1024", "768:1344", "1344:768"
 *
 * Supported ratios:
 *  - Portrait (9:16):  "768:1344"
 *  - Landscape (16:9): "1344:768"
 *  - Square (1:1):     "1024:1024"
 *  - Classic (4:3):    "1024:768"
 *  - Portrait (3:4):   "768:1024"
 */
export async function generateRunwayImage(
    prompt: string,
    ratio: string = "1024:1024"
): Promise<string> {
    const allKeys = getKeys();
    if (allKeys.length === 0) {
        throw new Error("No RUNWAY_API_KEY found in environment variables");
    }

    // Shuffle keys for random rotation
    const shuffledKeys = [...allKeys]
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

    const errors: string[] = [];

    for (let i = 0; i < shuffledKeys.length; i++) {
        const apiKey = shuffledKeys[i];
        const keyIndex = allKeys.indexOf(apiKey);

        try {
            console.log(`⏳ Submitting RunwayML task using key #${keyIndex + 1}/${allKeys.length}...`);

            const taskId = await submitRunwayTask(prompt, ratio, apiKey);
            console.log(`✅ RunwayML task submitted! key: #${keyIndex + 1}, id: ${taskId}`);

            const imageUrl = await pollRunwayTask(taskId, apiKey);
            console.log(`✅ RunwayML image ready: ${imageUrl.substring(0, 80)}...`);

            return imageUrl;

        } catch (error: any) {
            const isRateLimit = error instanceof RateLimitError || error.message?.includes("429");

            if (isRateLimit) {
                console.warn(`⚠️ RunwayML key #${keyIndex + 1} rate-limited (429). Trying next key...`);
                errors.push(`Key #${keyIndex + 1}: Rate limited (429)`);
                continue;
            }

            // For non-rate-limit errors, don't retry with other keys
            console.error(`🧨 RunwayML key #${keyIndex + 1} error: ${error.message}`);
            throw error;
        }
    }

    throw new Error(`All ${allKeys.length} RunwayML keys failed:\n${errors.join("\n")}`);
}
