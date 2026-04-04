import { putWithRotation } from "@/lib/blob";
import { NextRequest, NextResponse } from "next/server";
import * as zlib from "node:zlib";

// ─── Constants ────────────────────────────────────────────────────────────────
const INIT_IMAGE_ENDPOINT     = "https://cloud.leonardo.ai/api/rest/v1/init-image";
const IMAGE_TO_VIDEO_ENDPOINT = "https://cloud.leonardo.ai/api/rest/v1/generations-image-to-video";
const POLL_ENDPOINT           = "https://cloud.leonardo.ai/api/rest/v1/generations";
const KLING_MODEL             = "KLING2_5";
const SARVAM_BASE             = "https://api.sarvam.ai";
const GEMINI_MODEL            = "gemini-2.5-flash";

// ─── Key helpers ──────────────────────────────────────────────────────────────
function getLeonardoKeys(): string[] {
    const names = [
        "LEONARDO_API_KEY","LEONARDO_API_KEY1","LEONARDO_API_KEY2","LEONARDO_API_KEY3",
        "LEONARDO_API_KEY4","LEONARDO_API_KEY5","LEONARDO_API_KEY6","LEONARDO_API_KEY7",
        "LEONARDO_API_KEY8","LEONARDO_API_KEY9",
    ];
    return names.map(n => process.env[n]).filter((k): k is string => !!k && k.length > 0);
}
const getGeminiKey  = () => process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_IMAGE || "";
const getSarvamKey  = () => process.env.SARVAM_API_KEY || "";

// ─── Minimal ZIP creator (single file, no compression) ────────────────────────
function crc32(buf: Buffer): number {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createSingleFileZip(filename: string, data: Buffer): Buffer {
    const name    = Buffer.from(filename, "utf8");
    const crc     = crc32(data);
    const size    = data.length;
    const now     = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    // Local file header (30 + name)
    const lh = Buffer.alloc(30 + name.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(size, 18); lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    name.copy(lh, 30);

    // Central directory (46 + name)
    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10); cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(size, 20); cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(0, 42);
    name.copy(cd, 46);

    // End of central directory (22)
    const ecd = Buffer.alloc(22);
    ecd.writeUInt32LE(0x06054b50, 0);
    ecd.writeUInt16LE(0, 4); ecd.writeUInt16LE(0, 6);
    ecd.writeUInt16LE(1, 8); ecd.writeUInt16LE(1, 10);
    ecd.writeUInt32LE(cd.length, 12);
    ecd.writeUInt32LE(lh.length + data.length, 16);
    ecd.writeUInt16LE(0, 20);

    return Buffer.concat([lh, data, cd, ecd]);
}

/** Extract first file from a ZIP buffer (handles stored + deflate) */
function extractFirstFileFromZip(zipBuf: Buffer): string {
    let offset = 0;
    while (offset < zipBuf.length - 4 && zipBuf.readUInt32LE(offset) !== 0x04034b50) offset++;
    if (offset >= zipBuf.length - 30) return "";
    const compression    = zipBuf.readUInt16LE(offset + 8);
    const compressedSize = zipBuf.readUInt32LE(offset + 18);
    const filenameLen    = zipBuf.readUInt16LE(offset + 26);
    const extraLen       = zipBuf.readUInt16LE(offset + 28);
    const dataStart      = offset + 30 + filenameLen + extraLen;
    const fileData       = zipBuf.slice(dataStart, dataStart + compressedSize);
    try {
        return compression === 8
            ? zlib.inflateRawSync(fileData).toString("utf-8")
            : fileData.toString("utf-8");
    } catch { return fileData.toString("utf-8"); }
}

// ─── Step 1a: Sarvam Vision (image caption) ───────────────────────────────────
async function captionWithSarvam(imgBuf: Buffer, contentType: string): Promise<string> {
    const key = getSarvamKey();
    if (!key) throw new Error("No SARVAM_API_KEY");

    const ext         = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const imgFilename = `image.${ext}`;
    const zipFilename = "image.zip";
    const zipBuf      = createSingleFileZip(imgFilename, imgBuf);

    const headers = { "api-subscription-key": key, "Content-Type": "application/json" };

    // 1. Create job
    const createRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1`, {
        method: "POST", headers,
        body: JSON.stringify({ job_parameters: { language: "en-IN", output_format: "md" } }),
    });
    if (!createRes.ok) throw new Error(`Sarvam create job failed: ${createRes.status}`);
    const { job_id } = await createRes.json();
    console.log(`📄 [img-to-video] Sarvam job created: ${job_id}`);

    // 2. Get presigned upload URL
    const uploadUrlRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/upload-files`, {
        method: "POST", headers,
        body: JSON.stringify({ job_id, files: [zipFilename] }),
    });
    if (!uploadUrlRes.ok) throw new Error(`Sarvam upload-files failed: ${uploadUrlRes.status}`);
    const uploadData = await uploadUrlRes.json();
    const fileUrlDetails = uploadData?.upload_urls?.[zipFilename];
    const fileUrl        = fileUrlDetails?.file_url;
    if (!fileUrl) throw new Error("No upload URL from Sarvam");

    // 3. PUT ZIP to the presigned URL
    // ─────────────────────────────────────────────────────────────────────────
    // Sarvam uses Azure Blob Storage (storage_container_type = "Azure").
    // Azure SAS-URL PUTs REQUIRE the header `x-ms-blob-type: BlockBlob`.
    // Without it Azure returns: 400 <?xml…><Error><Code>MissingRequiredHeader
    // ─────────────────────────────────────────────────────────────────────────
    const storageType: string = (uploadData?.storage_container_type ||"").toLowerCase();
    const isAzure = storageType.startsWith("azure") || fileUrl.includes(".blob.core.windows.net");

    // file_metadata may carry additional required headers (some Sarvam backends)
    const extraHeaders: Record<string, string> = {};
    const fileMeta = fileUrlDetails?.file_metadata;
    if (fileMeta && typeof fileMeta === "object") {
        for (const [k, v] of Object.entries(fileMeta)) {
            if (typeof v === "string") extraHeaders[k] = v;
        }
    }

    const putHeaders: Record<string, string> = {
        "Content-Type": "application/zip",
        ...extraHeaders,
        ...(isAzure ? { "x-ms-blob-type": "BlockBlob" } : {}),
    };

    console.log(`☁️ [img-to-video] Storage: ${storageType || "unknown"}, Azure: ${isAzure}`);

    const putRes = await fetch(fileUrl, { method: "PUT", headers: putHeaders, body: zipBuf as unknown as BodyInit });
    if (!putRes.ok && putRes.status !== 201 && putRes.status !== 200) {
        const errBody = await putRes.text().catch(() => "");
        throw new Error(`Sarvam ZIP upload failed: ${putRes.status} — ${errBody.slice(0, 200)}`);
    }

    // 4. Start job
    const startRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${job_id}/start`, {
        method: "POST", headers, body: "{}",
    });
    if (!startRes.ok) throw new Error(`Sarvam start failed: ${startRes.status}`);
    console.log(`🚀 [img-to-video] Sarvam job started`);

    // 5. Poll status (max 15 × 3s = 45s)
    let jobState = "Pending";
    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${job_id}/status`, {
            headers: { "api-subscription-key": key },
        });
        if (!statusRes.ok) continue;
        const sd = await statusRes.json();
        jobState = sd.job_state;
        console.log(`⏳ [img-to-video] Sarvam poll ${i + 1}/15: ${jobState}`);
        if (jobState === "Completed" || jobState === "PartiallyCompleted") break;
        if (jobState === "Failed") throw new Error(`Sarvam job failed: ${sd.error_message}`);
    }
    if (jobState !== "Completed" && jobState !== "PartiallyCompleted") {
        throw new Error(`Sarvam timed out (state: ${jobState})`);
    }

    // 6. Get download URLs
    const dlRes = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${job_id}/download-files`, {
        method: "POST", headers, body: "{}",
    });
    if (!dlRes.ok) throw new Error(`Sarvam download-files failed: ${dlRes.status}`);
    const dlData        = await dlRes.json();
    const downloadUrls  = dlData?.download_urls || {};
    const firstKey      = Object.keys(downloadUrls)[0];
    if (!firstKey) throw new Error("No download URLs from Sarvam");

    // 7. Download output
    const dlFileUrl  = downloadUrls[firstKey]?.file_url || firstKey;
    const contentRes = await fetch(dlFileUrl);
    if (!contentRes.ok) throw new Error(`Sarvam output download failed: ${contentRes.status}`);
    const contentBuf = Buffer.from(await contentRes.arrayBuffer());

    // Output can be a ZIP or plain markdown
    let markdown = "";
    if (contentBuf[0] === 0x50 && contentBuf[1] === 0x4B) {
        // It's a ZIP
        markdown = extractFirstFileFromZip(contentBuf);
    } else {
        markdown = contentBuf.toString("utf-8");
    }

    const result = markdown.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
    console.log(`✅ [img-to-video] Sarvam caption: "${result.slice(0, 100)}..."`);
    return result;
}

// ─── Step 1b: Gemini Vision (fallback caption) ────────────────────────────────
async function captionWithGemini(imgBuf: Buffer, contentType: string): Promise<string> {
    const key = getGeminiKey();
    if (!key) throw new Error("No Gemini API key for vision");
    const base64 = imgBuf.toString("base64");
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { inline_data: { mime_type: contentType, data: base64 } },
                        { text: "Describe this image precisely in English. Include: 1) Every person visible (exact clothing, colors, positions, expressions) 2) All objects and their locations 3) The setting/environment in detail 4) Lighting, colors, mood 5) Background elements. Be thorough — this will be used to animate the image while KEEPING all elements exactly as shown." },
                    ],
                }],
                generationConfig: { maxOutputTokens: 500, temperature: 0.2 },
            }),
        }
    );
    if (!res.ok) throw new Error(`Gemini vision failed: ${res.status}`);
    const data = await res.json();
    const caption = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    console.log(`✅ [img-to-video] Gemini vision caption: "${caption.slice(0, 100)}..."`);
    return caption;
}

// ─── Step 2: Gemini → element-by-element Kling animation script ────────────────
async function buildKlingPrompt(caption: string, narration: string): Promise<string> {
    const key = getGeminiKey();
    if (!key || !caption) return buildFallbackPrompt(caption, narration);

    const prompt = `You are a Kling AI video director. A static image will be animated. Your job is to write a HIGHLY SPECIFIC, ELEMENT-BY-ELEMENT motion script that makes every part of the image intensely alive.

ANALYZE the image caption. Then write a motion prompt that:
1. NAMES EACH PERSON specifically and gives them STRONG motion: eyes blinking with wet gleam, chest visibly rising and falling, head tilting or nodding slightly, lips parting softly, hands with micro-tremor, hair strands whipping in breeze, earrings/jewelry swinging, fabric pulling and rippling in wind
2. NAMES EACH OBJECT and gives it motion: items swaying, spinning slowly, light glinting off surfaces, liquid rippling, fire flickering, smoke curling
3. MAKES THE BACKGROUND BREATHE: depth-of-field shimmer, light rays shifting, dust motes drifting, foliage oscillating, clouds sliding, shadows morphing
4. CAMERA: drifts very slowly like a floating drone — NO zoom-in, NO push toward subjects, just a gentle parallax float

Motion must be STRONG and VISIBLE. Kling responds to assertive, specific language. Do NOT use vague words like "subtle" or "slight" — use words like "clearly", "visibly", "actively", "expressively".

IMAGE CAPTION:
${caption.slice(0, 900)}

Write a flowing 110-140 word motion script now. Name specific elements. Make it intense and vivid:`;

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { maxOutputTokens: 300, temperature: 0.85 },
                }),
            }
        );
        if (!res.ok) return buildFallbackPrompt(caption, narration);
        const data = await res.json();
        const refined = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        if (!refined) return buildFallbackPrompt(caption, narration);
        // Append a tight no-zoom anchor that doesn't constrain subject motion
        const result = (refined.trim().replace(/\.?$/, "") + ". Camera floats gently, no zoom-in.").slice(0, 500);
        console.log(`✅ [img-to-video] Kling prompt: "${result.slice(0, 120)}..."`);
        return result;
    } catch {
        return buildFallbackPrompt(caption, narration);
    }
}

function buildFallbackPrompt(caption: string, narration: string): string {
    // Extract subject hint from caption for grounding
    const subjectHint = caption ? caption.split(".")[0].trim() : "";
    const subjectLine = subjectHint
        ? `${subjectHint}. `
        : "";
    return (
        `${subjectLine}` +
        `Every element in the scene becomes intensely alive: ` +
        `each person's chest visibly rises and falls with full breaths, ` +
        `eyes blink with a wet gleam, head nods expressively, ` +
        `hair strands whip and swirl actively in a strong warm breeze, ` +
        `loose clothing billows and ripples dramatically. ` +
        `Background elements oscillate — foliage sways with momentum, ` +
        `light rays shift and sweep across surfaces, dust motes spiral through the air, ` +
        `atmospheric haze pulses with depth. ` +
        `Camera drifts with a slow, weightless float. No zoom-in. ` +
        `${narration.slice(0, 60)}.`
    ).trim().slice(0, 500);
}

// ─── Leonardo / Kling helpers (unchanged) ────────────────────────────────────
async function uploadImageToLeonardo(imageUrl: string, apiKey: string): Promise<string> {
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) throw new Error(`Failed to download image: ${imageRes.status}`);
    const imageBuffer = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("webp") ? "webp"
              : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
              : "png";

    const initRes = await fetch(INIT_IMAGE_ENDPOINT, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ extension: ext }),
    });
    if (!initRes.ok) throw new Error(`Leonardo init-image failed (${initRes.status}): ${await initRes.text()}`);
    const initData  = await initRes.json();
    const uploadUrl = initData?.uploadInitImage?.url;
    const imageId   = initData?.uploadInitImage?.id;
    const fields    = initData?.uploadInitImage?.fields ? JSON.parse(initData.uploadInitImage.fields) : null;
    if (!uploadUrl || !imageId) throw new Error(`Missing url/id from init-image: ${JSON.stringify(initData).slice(0, 200)}`);

    if (fields) {
        const form = new FormData();
        for (const [k, v] of Object.entries(fields)) form.append(k, v as string);
        form.append("file", new Blob([imageBuffer], { type: contentType }), `upload.${ext}`);
        const uploadRes = await fetch(uploadUrl, { method: "POST", body: form });
        if (!uploadRes.ok && uploadRes.status !== 204) throw new Error(`Image upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
    } else {
        const uploadRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: imageBuffer });
        if (!uploadRes.ok && uploadRes.status !== 200) throw new Error(`Image upload PUT failed (${uploadRes.status}): ${await uploadRes.text()}`);
    }
    return imageId;
}

// Kling API constraints:
//   resolution: always "RESOLUTION_1080"
//   width / height: must each be one of 1080, 1440, 1920
//   Shorts (9:16): width=1080, height=1920
//   Landscape (16:9): width=1920, height=1080
async function submitImg2VidJob(
    imageId: string, prompt: string, duration: 5 | 10,
    apiKey: string, forceShorts = true
): Promise<string> {
    // No suffix needed — anti-zoom is embedded directly in the prompt itself
    const finalPrompt = prompt.trim().slice(0, 1500);

    // Try portrait first for Shorts; fall back to landscape if the API rejects it
    const candidates = forceShorts
        ? [
            { width: 1080, height: 1920, label: "9:16 portrait (Shorts)" },
            { width: 1920, height: 1080, label: "16:9 landscape (fallback)" },
          ]
        : [
            { width: 1920, height: 1080, label: "16:9 landscape" },
          ];

    let lastError = "";
    for (const dims of candidates) {
        const body = JSON.stringify({
            prompt: finalPrompt,
            imageId, imageType: "UPLOADED",
            resolution: "RESOLUTION_1080",          // only valid value per API docs
            width: dims.width, height: dims.height,
            duration, model: KLING_MODEL, isPublic: false,
        });
        console.log(`📐 [img-to-video] Trying ${dims.label} (${dims.width}×${dims.height})...`);
        const res = await fetch(IMAGE_TO_VIDEO_ENDPOINT, {
            method: "POST",
            headers: { accept: "application/json", authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body,
        });
        if (!res.ok) {
            const errText = await res.text();
            lastError = `Kling img2vid submit failed (${res.status}): ${errText}`;
            console.warn(`⚠️ [img-to-video] ${dims.label} rejected: ${errText.slice(0, 150)}`);
            continue;
        }
        const data = await res.json();
        const generationId =
            data?.motionVideoGenerationJob?.generationId ||
            data?.sdGenerationJob?.generationId ||
            data?.generationId;
        if (!generationId) throw new Error(`Missing generationId from Kling: ${JSON.stringify(data).slice(0, 300)}`);
        console.log(`✅ [img-to-video] Accepted ${dims.label}, generationId=${generationId}`);
        return generationId;
    }
    throw new Error(lastError || "All Kling resolution candidates failed");
}

async function pollKling(generationId: string, apiKey: string): Promise<string> {
    const MAX = 80;
    for (let i = 0; i < MAX; i++) {
        const delay = i < 3 ? 5000 : i < 8 ? 8000 : i < 18 ? 12000 : 15000;
        await new Promise(r => setTimeout(r, delay));
        const res = await fetch(`${POLL_ENDPOINT}/${generationId}`, {
            headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
        });
        if (res.status === 429) { await new Promise(r => setTimeout(r, 10000)); continue; }
        if (res.status === 404 && i < 10) { continue; }
        if (!res.ok) throw new Error(`Kling poll failed (${res.status}): ${await res.text()}`);
        const data = await res.json();
        const gen  = data?.generations_by_pk;
        if (gen?.status === "COMPLETE") {
            const videos = gen?.generated_images?.filter((img: any) => img.motionMP4URL);
            if (videos?.length > 0) return videos[0].motionMP4URL;
            const images = gen?.generated_images;
            if (images?.length > 0) return images[0].motionMP4URL || images[0].url;
            throw new Error("Kling COMPLETE but no video URL found");
        }
        if (gen?.status === "FAILED") throw new Error(`Kling job FAILED: ${JSON.stringify(data).slice(0, 300)}`);
    }
    throw new Error(`Kling img2vid timed out after ${MAX} polls`);
}

async function uploadVideoToAppwrite(klingVideoUrl: string, sceneIndex: number): Promise<{ finalUrl: string; isKlingFallback: boolean }> {
    let buffer: Buffer | null = null;
    try {
        const res = await fetch(klingVideoUrl);
        if (res.ok) buffer = Buffer.from(await res.arrayBuffer());
    } catch (e) {
        console.warn("[img-to-video] Could not download Kling video:", e);
    }
    if (!buffer) return { finalUrl: klingVideoUrl, isKlingFallback: true };
    try {
        const pathname = `studio/img2vid/scene${sceneIndex}_${Date.now()}.mp4`;
        const result   = await putWithRotation(pathname, buffer, { access: "public", contentType: "video/mp4" });
        console.log(`✅ [img-to-video] Uploaded: ${result.url.slice(0, 80)}`);
        return { finalUrl: result.url, isKlingFallback: false };
    } catch (e: any) {
        console.warn(`[img-to-video] Upload failed: ${e.message?.slice(0, 100)}`);
        return { finalUrl: klingVideoUrl, isKlingFallback: true };
    }
}

// ─── POST /api/studio/img-to-video ───────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        // forceShorts defaults to true — always generate in 9:16 Shorts format
        const { imageUrl, sceneNarration = "", sceneIndex = 0, duration = 5, forceShorts = true } = body;

        if (!imageUrl) return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });

        const validDuration: 5 | 10 = duration >= 8 ? 10 : 5;
        const keys = getLeonardoKeys();
        if (keys.length === 0) return NextResponse.json({ error: "No Leonardo API keys configured" }, { status: 500 });

        console.log(`📱 [img-to-video] Format: ${forceShorts ? "SHORTS (9:16 portrait)" : "LANDSCAPE (16:9)"}`);

        // ── Step 1: Download the image for captioning ──────────────────────────
        let imgBuf: Buffer | null = null;
        let contentType = "image/jpeg";
        try {
            const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
            if (imgRes.ok) {
                imgBuf      = Buffer.from(await imgRes.arrayBuffer());
                contentType = imgRes.headers.get("content-type") || "image/jpeg";
                // Normalise content-type
                if (!contentType.startsWith("image/")) contentType = "image/jpeg";
            }
        } catch (e) {
            console.warn("[img-to-video] Could not download image for captioning:", e);
        }

        // ── Step 2: Caption the image — Sarvam first, fallback Gemini vision ──
        let caption = "";
        if (imgBuf) {
            try {
                console.log("🔍 [img-to-video] Step 1: Sarvam Vision captioning...");
                caption = await captionWithSarvam(imgBuf, contentType);
            } catch (sarvamErr: any) {
                console.warn(`⚠️ [img-to-video] Sarvam failed (${sarvamErr.message?.slice(0, 80)}), trying Gemini vision...`);
                try {
                    caption = await captionWithGemini(imgBuf, contentType);
                } catch (geminiErr: any) {
                    console.warn(`⚠️ [img-to-video] Gemini vision also failed: ${geminiErr.message?.slice(0, 80)}`);
                }
            }
        }

        // ── Step 3: Gemini refines caption → Kling subject-preserving, anti-zoom prompt ──
        console.log("✍️ [img-to-video] Step 2: Building Kling anti-zoom motion prompt...");
        const klingPrompt = await buildKlingPrompt(caption, sceneNarration);
        console.log(`📝 [img-to-video] Final Kling prompt: "${klingPrompt.slice(0, 120)}..."`);

        // ── Step 4: Kling animation ────────────────────────────────────────────
        let klingVideoUrl = "";
        let lastErr       = "";

        for (const apiKey of keys) {
            try {
                console.log(`🎬 [img-to-video] Uploading image to Leonardo (key: ...${apiKey.slice(-6)})...`);
                const imageId = await uploadImageToLeonardo(imageUrl, apiKey);

                console.log(`🚀 [img-to-video] Submitting Kling job (${validDuration}s, shorts=${forceShorts})...`);
                const generationId = await submitImg2VidJob(imageId, klingPrompt, validDuration, apiKey, forceShorts);

                console.log(`⏳ [img-to-video] Polling Kling job ${generationId}...`);
                klingVideoUrl = await pollKling(generationId, apiKey);

                console.log(`🎥 [img-to-video] Kling completed: ${klingVideoUrl.slice(0, 80)}`);
                break;
            } catch (e: any) {
                lastErr = e.message;
                console.warn(`⚠️ [img-to-video] Key attempt failed: ${e.message?.slice(0, 120)}`);
            }
        }

        if (!klingVideoUrl) {
            return NextResponse.json({ error: `img-to-video failed: ${lastErr}` }, { status: 500 });
        }

        // ── Step 5: Upload to Appwrite ─────────────────────────────────────────
        console.log(`📦 [img-to-video] Uploading to Appwrite...`);
        const { finalUrl, isKlingFallback } = await uploadVideoToAppwrite(klingVideoUrl, sceneIndex);

        return NextResponse.json({
            ok: true, videoUrl: finalUrl,
            durationSec: validDuration, isKlingFallback,
            isShorts: !!forceShorts,
        });

    } catch (err: any) {
        console.error("studio/img-to-video error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
