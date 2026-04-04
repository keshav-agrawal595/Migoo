import { gemini } from "@/config/gemini";
import { NextRequest, NextResponse } from "next/server";

// POST /api/studio/generate-script
// body: { topic, contextMarkdown?, instruction?, language, seriesNiche, docImages? }
// Returns: { scriptData }

export async function POST(req: NextRequest) {
    try {
        const { topic, contextMarkdown, instruction, language, seriesNiche, docImages } = await req.json();

        if (!topic && !contextMarkdown) {
            return NextResponse.json({ error: "topic or contextMarkdown required" }, { status: 400 });
        }

        const lang = language === "hi-IN" ? "HINDI" : "ENGLISH";
        const WORDS_PER_SEC = 2.5;
        const sceneCount = 6;
        const totalWordsMin = Math.ceil(80 * WORDS_PER_SEC);  // 200
        const totalWordsMax = Math.ceil(120 * WORDS_PER_SEC); // 300

        // Build context block for Gemini
        let contextBlock = "";
        if (contextMarkdown) {
            contextBlock = `
REFERENCE DOCUMENT (Extracted via Sarvam Document Intelligence):
---
${contextMarkdown.slice(0, 8000)}
---
${instruction ? `USER INSTRUCTION: ${instruction}` : ""}

The document above is your PRIMARY SOURCE. Base the video script on the actual facts, data, and insights from this document. Do NOT fabricate information.
`;
        }

        // Build image context for multimodal
        let imageContext = "";
        if (docImages && docImages.length > 0) {
            imageContext = `
DOCUMENT IMAGES/CHARTS: The following image URLs were extracted from the document: ${docImages.slice(0, 5).join(", ")}
If a specific chart or graph is crucial for a scene, set that scene's asset_url to the image URL and sceneCategory to "doc_image". Remotion will display the actual chart on screen.
`;
        }

        const systemPrompt = `You are a viral storyteller and documentary scriptwriter. Write an engaging ${lang} video script.

🚨 SUPER CRITICAL RULES:
1. Output ONLY a valid JSON object wrapped in <json> and </json> tags.
2. NEVER output markdown code blocks.
3. If a reference document is provided, base the script on its actual content. Be accurate.

SCRIPT REQUIREMENTS:
1. TOTAL LENGTH: 250-300 words of narration across ALL 6 scenes.
2. SCENES: Use keys "scene1" through "scene6" (not an array).
3. LANGUAGE: Write ENTIRELY in ${lang}. Natural, flowing, native phrasing.
4. NARRATION STYLE: No meta-commentary ("Scene 1", "Here's a video about"). Start directly with the hook. Each scene: 40-50 words.
5. IMAGE PROMPTS: For "real_entity" scenes — 30-50 word ultra-detailed photorealistic prompts (lighting, angle, texture, atmosphere, lens).
6. VIDEO PROMPTS: For ALL scenes — 30-50 word cinematic video description (camera movement, effects).
7. THUMBNAIL: A stunning, text-free, click-worthy visual prompt (30-40 words). NO TEXT, NO WORDS, NO LETTERS.
8. SCENE CATEGORY:
   - "real_entity": real person, real monument, real artifact, historical site
   - "living_thing": fictional/generic people, animals
   - "general": abstract, graphics, concepts
   - "doc_image": when you assign an extracted document chart/image as the scene background
${imageContext}
9. TTS FORMATTING: No ellipses, em-dashes, en-dashes, ALL CAPS, colons, semicolons, or parentheticals. Clean short sentences only.

JSON SCHEMA — return EXACTLY this wrapped in <json> tags:
<json>
{
  "videoTitle": "compelling viral title",
  "thumbnailPrompt": "stunning text-free visual...",
  "totalScenes": 6,
  "totalWordCount": 275,
  "scene1": {
    "narration": "40-50 word hook...",
    "imagePrompt": "ultra-detailed photorealistic description...",
    "videoPrompt": "cinematic camera movement description...",
    "sceneCategory": "real_entity",
    "asset_url": null,
    "duration": 16,
    "wordCount": 42
  },
  "scene2": { ... },
  "scene3": { ... },
  "scene4": { ... },
  "scene5": { ... },
  "scene6": { ... }
}
</json>

🚨 Complete ALL 6 scenes. Output ONLY the <json> block.`;

        const userPrompt = `Topic: "${topic || "Summarize the key insights from the document"}"
Niche: "${seriesNiche || "general"}"
${contextBlock}

Write a complete 6-scene viral script. 250+ words total. Use keys scene1 through scene6.
OUTPUT ONLY: <json>{...}</json>`;

        const MAX_ATTEMPTS = 2;
        let bestResult: any = null;
        let bestWordCount = 0;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const sceneSchema = {
                    type: 'object',
                    properties: {
                        narration:     { type: 'string' },
                        imagePrompt:   { type: 'string' },
                        videoPrompt:   { type: 'string' },
                        sceneCategory: { type: 'string', enum: ['real_entity', 'living_thing', 'general', 'doc_image'] },
                        asset_url:     { type: 'string', nullable: true },
                        duration:      { type: 'number' },
                        wordCount:     { type: 'number' },
                    },
                    required: ['narration', 'imagePrompt', 'videoPrompt', 'sceneCategory'],
                };
                const result = await gemini.json(systemPrompt, userPrompt, {
                    temperature: attempt === 1 ? 0.75 : 0.85,
                    maxOutputTokens: 8192,
                    schema: {
                        type: 'object',
                        properties: {
                            videoTitle:      { type: 'string' },
                            thumbnailPrompt: { type: 'string' },
                            totalScenes:     { type: 'number' },
                            totalWordCount:  { type: 'number' },
                            scene1: sceneSchema, scene2: sceneSchema, scene3: sceneSchema,
                            scene4: sceneSchema, scene5: sceneSchema, scene6: sceneSchema,
                        },
                        required: ['videoTitle', 'thumbnailPrompt', 'scene1', 'scene2', 'scene3', 'scene4', 'scene5', 'scene6'],
                    },
                });

                // Map explicit keys to scenes array
                if (!result.scenes || !Array.isArray(result.scenes) || result.scenes.length === 0) {
                    const extractedScenes: any[] = [];
                    for (let i = 1; i <= sceneCount; i++) {
                        const key = `scene${i}`;
                        if (result[key]) {
                            extractedScenes.push({ ...result[key], sceneNumber: i });
                            delete result[key];
                        }
                    }
                    result.scenes = extractedScenes;
                }

                if (!result.scenes || result.scenes.length < sceneCount) continue;

                const wordCount = result.scenes.reduce(
                    (sum: number, s: any) => sum + (s.narration?.split(/\s+/).length || 0), 0
                );

                if (wordCount > bestWordCount) {
                    bestResult = result;
                    bestWordCount = wordCount;
                }

                if (wordCount >= totalWordsMin * 0.85) break;
            } catch (err: any) {
                console.error(`Script gen attempt ${attempt} failed:`, err.message);
            }
        }

        if (!bestResult) {
            return NextResponse.json({ error: "Script generation failed. Please try again." }, { status: 500 });
        }

        // Recalculate durations
        for (const scene of bestResult.scenes) {
            const words = scene.narration?.split(/\s+/).length || 0;
            scene.wordCount = words;
            scene.duration = Math.round(words / WORDS_PER_SEC);
        }
        bestResult.totalWordCount = bestWordCount;

        return NextResponse.json({ scriptData: bestResult });
    } catch (err: any) {
        console.error("studio/generate-script error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
