import { VideoSlidesDummy } from "@/data/Dummy";
import axios from "axios";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    const { chapter, courseId } = await req.json();


    //     const result = await groq.json(
    //         GENERATE_VIDEO_PROMPT,
    //                 JSON.stringify(chapter),
    //                 {
    //                     model: 'openai/gpt-oss-120b',
    //                     temperature: 0.7,
    //                     max_tokens: 4000
    //                 }
    //             );

    //             console.log('✅ Groq API Response Received:', {
    //                 resultType: typeof result,
    //                 isArray: Array.isArray(result),
    //                 length: Array.isArray(result) ? result.length : 'N/A'
    //             });

    //             if (Array.isArray(result)) {
    //                 console.log('📊 First slide preview:', JSON.stringify(result[0], null, 2));
    //             }

    //             return NextResponse.json({
    //                 success: true,
    //                 data: result,
    //                 metadata: {
    //                     generatedAt: new Date().toISOString(),
    //                     model: 'openai/gpt-oss-120b',
    //                     courseId
    //                 }
    //             });

    // Audio File
    const VideoContentJson = VideoSlidesDummy;

    for (let i = 0; i < VideoContentJson.length; i++) {
        const narration = VideoContentJson[i].narration.fullText;
        const fonadaResult = await axios.post("https://api.fonada.ai/tts/generate-audio-large", {
            input: narration,
            voice: "Vaanee",
            Languages: "English",
        },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${process.env.FONADALAB_API_KEY}`
                },
                responseType: "arraybuffer",
                timeout: 120000
            })
        const audioBuffer = Buffer.from(fonadaResult.data);
        console.log(audioBuffer);
    }
}
