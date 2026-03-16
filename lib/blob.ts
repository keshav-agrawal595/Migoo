import { put, type PutBlobResult } from "@vercel/blob";

// ═══════════════════════════════════════════════════════════════════════════════
// VERCEL BLOB TOKEN ROTATION
// Distributes uploads across 5 Hobby accounts to avoid quota limits.
// Each call picks a random token; if it fails (quota hit), tries the rest.
// ═══════════════════════════════════════════════════════════════════════════════

const BLOB_TOKENS: string[] = [
    process.env.BLOB_READ_WRITE_TOKEN,
    process.env.BLOB_READ_WRITE_TOKEN1,
    process.env.BLOB_READ_WRITE_TOKEN2,
    process.env.BLOB_READ_WRITE_TOKEN3,
    process.env.BLOB_READ_WRITE_TOKEN4,
].filter((t): t is string => !!t);

if (BLOB_TOKENS.length === 0) {
    console.error("❌ No BLOB_READ_WRITE_TOKEN* env vars found!");
}

console.log(`🔄 Blob rotation loaded: ${BLOB_TOKENS.length} accounts available`);

/**
 * Returns a random valid token from the list.
 */
export function getBlobToken(): string {
    if (BLOB_TOKENS.length === 0) return "";
    const idx = Math.floor(Math.random() * BLOB_TOKENS.length);
    return BLOB_TOKENS[idx];
}

/**
 * Pick a random starting index, then try each token in order.
 * If a put() fails (e.g. quota exceeded), skip to the next token.
 * Throws only if ALL tokens fail.
 */
export async function putWithRotation(
    pathname: string,
    body: Parameters<typeof put>[1],
    options: Omit<Parameters<typeof put>[2], "token">
): Promise<PutBlobResult> {
    if (BLOB_TOKENS.length === 0) {
        throw new Error("No Vercel Blob tokens configured");
    }

    // Random starting index so usage spreads evenly
    const startIdx = Math.floor(Math.random() * BLOB_TOKENS.length);
    const errors: string[] = [];

    for (let attempt = 0; attempt < BLOB_TOKENS.length; attempt++) {
        const idx = (startIdx + attempt) % BLOB_TOKENS.length;
        const token = BLOB_TOKENS[idx];

        try {
            console.log(`🔄 Blob upload using account #${idx + 1}/${BLOB_TOKENS.length}`);
            const result = await put(pathname, body, {
                ...options,
                token,
            });
            console.log(`✅ Blob upload success (account #${idx + 1}): ${result.url}`);
            return result;
        } catch (err: any) {
            const msg = err?.message || String(err);
            console.warn(`⚠️ Blob account #${idx + 1} failed: ${msg}`);
            errors.push(`Account #${idx + 1}: ${msg}`);
        }
    }

    throw new Error(
        `All ${BLOB_TOKENS.length} Vercel Blob accounts failed:\n${errors.join("\n")}`
    );
}
