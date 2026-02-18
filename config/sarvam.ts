/**
 * Sarvam AI Configuration - Complete TTS + STT Solution
 * Includes: JSON Generation, Text-to-Speech, and Speech-to-Text
 */

import { SarvamAIClient } from "sarvamai";
import fetch from "node-fetch";

class SarvamClient {
    private client: SarvamAIClient;
    private apiKey: string;

    constructor() {
        const apiKey = process.env.SARVAM_API_KEY;
        if (!apiKey) {
            throw new Error('SARVAM_API_KEY is not set in environment variables');
        }

        this.apiKey = apiKey;
        this.client = new SarvamAIClient({
            apiSubscriptionKey: apiKey
        });
    }

    /**
     * Generate JSON response with Sarvam AI
     */
    async generateJson(
        systemPrompt: string,
        userInput: string,
        options?: {
            temperature?: number;
            maxTokens?: number;
            reasoningEffort?: 'low' | 'medium' | 'high';
        }
    ): Promise<any> {
        const temperature = options?.temperature ?? 0.3;
        const maxTokens = options?.maxTokens ?? 8000;
        const reasoningEffort = options?.reasoningEffort;

        console.log('🤖 Sarvam AI Generation Started');
        console.log(`📊 Config: temp=${temperature}, max_tokens=${maxTokens}, reasoning=${reasoningEffort || 'none'}`);
        console.log(`📝 Input: ${userInput.length} chars`);

        try {
            const truncatedInput = userInput.length > 4000
                ? userInput.substring(0, 4000) + "..."
                : userInput;

            const combinedSystemPrompt = `You are a JSON generator. ALWAYS output valid JSON immediately. NEVER use thinking mode, reasoning mode, or show your thought process. Output ONLY the JSON object or array, starting immediately with { or [ character.

${systemPrompt}`;

            const messages: any[] = [
                {
                    role: "system",
                    content: combinedSystemPrompt
                },
                {
                    role: "user",
                    content: truncatedInput
                }
            ];

            const response = await this.client.chat.completions({
                messages: messages,
                //@ts-ignore
                model: "sarvam-m",
                temperature: temperature,
                max_tokens: maxTokens,
                reasoning_effort: reasoningEffort,
                top_p: 0.95,
                frequency_penalty: 0.3,
                presence_penalty: 0.1
            });

            if (!response.choices?.[0]?.message?.content) {
                console.error('❌ Empty response from Sarvam AI');
                throw new Error('No content in Sarvam AI response');
            }

            const content = response.choices[0].message.content;
            console.log(`✅ Response: ${content.length} chars`);

            return this.extractAndParseJson(content);

        } catch (error: any) {
            console.error('❌ Sarvam AI Error:', error.message);
            throw error;
        }
    }

    /**
     * Transcribe audio using Sarvam AI Speech-to-Text
     * Returns word-level timestamps for precise caption generation
     */
    async transcribeAudio(audioUrl: string): Promise<{
        text: string;
        words: Array<{ text: string; start: number; end: number; }>;
        languageCode: string;
    }> {
        console.log('🎤 Starting Sarvam AI Speech-to-Text...');
        console.log('📍 Audio URL:', audioUrl);

        try {
            // Step 1: Download audio from URL
            console.log('📥 Downloading audio file...');
            const audioResponse = await fetch(audioUrl);
            if (!audioResponse.ok) {
                throw new Error(`Failed to download audio: ${audioResponse.status}`);
            }
            const audioBuffer = await audioResponse.buffer();
            console.log(`✅ Downloaded: ${audioBuffer.length} bytes`);

            // Step 2: Create temporary file path (we'll use buffer directly)
            const tempFileName = `temp_${Date.now()}.wav`;

            // Step 3: Create batch job for transcription
            console.log('🔄 Creating Sarvam AI batch job...');
            const job = await this.client.speechToTextJob.createJob({
                model: "saaras:v3",
                // @ts-ignore
                mode: "transcribe", // transcribe mode (not translate)
                languageCode: "en-IN", // English (India) - matches TTS
                withDiarization: false, // No speaker separation needed
                numSpeakers: 1
            });

            console.log('✅ Batch job created');

            // Step 4: Upload audio buffer as file
            console.log('📤 Uploading audio to Sarvam AI...');

            // Create a temporary file from buffer
            const fs = require('fs');
            const path = require('path');
            const os = require('os');

            const tempDir = os.tmpdir();
            const tempFilePath = path.join(tempDir, tempFileName);

            // Write buffer to temp file
            fs.writeFileSync(tempFilePath, audioBuffer);
            console.log(`📝 Temp file created: ${tempFilePath}`);

            // Upload file to job
            await job.uploadFiles([tempFilePath]);
            console.log('✅ Audio uploaded');

            // Step 5: Start processing
            console.log('⚙️ Starting transcription job...');
            await job.start();
            console.log('✅ Job started');

            // Step 6: Wait for completion
            console.log('⏳ Waiting for transcription to complete...');
            await job.waitUntilComplete();
            console.log('✅ Transcription complete!');

            // Step 7: Get results
            console.log('📊 Fetching results...');
            const fileResults = await job.getFileResults();

            // Clean up temp file
            try {
                fs.unlinkSync(tempFilePath);
                console.log('🗑️ Temp file cleaned up');
            } catch (e) {
                console.warn('⚠️ Could not delete temp file:', e);
            }

            // Check for failures
            if (fileResults.failed.length > 0) {
                const error = fileResults.failed[0];
                throw new Error(`Transcription failed: ${error.error_message}`);
            }

            if (fileResults.successful.length === 0) {
                throw new Error('No successful transcription results');
            }

            // Step 8: Download and parse output
            console.log('📥 Downloading transcription output...');
            const outputDir = path.join(tempDir, `sarvam_output_${Date.now()}`);
            fs.mkdirSync(outputDir, { recursive: true });

            await job.downloadOutputs(outputDir);
            console.log(`✅ Output downloaded to: ${outputDir}`);

            // Step 9: Read the JSON output
            const outputFiles = fs.readdirSync(outputDir);
            const jsonFile = outputFiles.find((f: string) => f.endsWith('.json'));

            if (!jsonFile) {
                throw new Error('No JSON output file found');
            }

            const outputPath = path.join(outputDir, jsonFile);
            const outputData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

            console.log('📄 Output structure:', Object.keys(outputData));

            // Step 10: Extract word-level timestamps
            // Sarvam AI output format (based on typical STT outputs):
            // { transcript: string, words: [...], segments: [...] }

            const fullText = outputData.transcript || outputData.text || '';
            const words = this.extractWordsFromSarvamOutput(outputData);

            console.log(`✅ Transcription complete: ${words.length} words`);
            console.log(`📝 Full text length: ${fullText.length} chars`);

            // Clean up output directory
            try {
                fs.rmSync(outputDir, { recursive: true, force: true });
                console.log('🗑️ Output directory cleaned up');
            } catch (e) {
                console.warn('⚠️ Could not delete output directory:', e);
            }

            return {
                text: fullText,
                words: words,
                languageCode: 'en-IN'
            };

        } catch (error: any) {
            console.error('❌ Sarvam AI STT Error:', error.message);
            console.error('Stack:', error.stack);
            throw error;
        }
    }

    /**
     * Extract word-level timestamps from Sarvam AI output
     */
    private extractWordsFromSarvamOutput(outputData: any): Array<{ text: string; start: number; end: number; }> {
        const words: Array<{ text: string; start: number; end: number; }> = [];

        // Try different possible output formats
        if (outputData.words && Array.isArray(outputData.words)) {
            // Format 1: Direct words array
            for (const word of outputData.words) {
                words.push({
                    text: word.word || word.text || '',
                    start: word.start || word.start_time || 0,
                    end: word.end || word.end_time || 0
                });
            }
        } else if (outputData.segments && Array.isArray(outputData.segments)) {
            // Format 2: Segments with words
            for (const segment of outputData.segments) {
                if (segment.words && Array.isArray(segment.words)) {
                    for (const word of segment.words) {
                        words.push({
                            text: word.word || word.text || '',
                            start: word.start || word.start_time || 0,
                            end: word.end || word.end_time || 0
                        });
                    }
                }
            }
        } else if (outputData.results && Array.isArray(outputData.results)) {
            // Format 3: Results array
            for (const result of outputData.results) {
                if (result.alternatives && Array.isArray(result.alternatives)) {
                    const alt = result.alternatives[0];
                    if (alt.words && Array.isArray(alt.words)) {
                        for (const word of alt.words) {
                            words.push({
                                text: word.word || word.text || '',
                                start: word.start || word.start_time || 0,
                                end: word.end || word.end_time || 0
                            });
                        }
                    }
                }
            }
        }

        // If no words found, try to split text with estimated timestamps
        if (words.length === 0 && outputData.transcript) {
            console.warn('⚠️ No word-level timestamps found, using fallback');
            const text = outputData.transcript;
            const wordTexts = text.split(/\s+/);
            const avgDuration = 0.5; // 0.5 seconds per word average

            wordTexts.forEach((wordText: string, i: number) => {
                words.push({
                    text: wordText,
                    start: i * avgDuration,
                    end: (i + 1) * avgDuration
                });
            });
        }

        console.log(`📊 Extracted ${words.length} words with timestamps`);
        return words;
    }

    /**
     * Robust JSON extraction from AI response
     */
    private extractAndParseJson(text: string): any {
        if (!text || text.trim().length === 0) {
            throw new Error('Empty response from AI');
        }

        console.log(`📄 Raw response length: ${text.length} chars`);

        let cleaned = text
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<\/?think>/gi, '')
            .trim();

        const jsonStart = this.findJsonStart(cleaned);
        if (jsonStart === -1) {
            throw new Error('No JSON structure found in response');
        }

        cleaned = cleaned.substring(jsonStart);

        const startChar = cleaned[0];
        const endChar = startChar === '{' ? '}' : ']';
        const matchEnd = this.findMatchingBracket(cleaned, 0, startChar, endChar);

        if (matchEnd === -1) {
            console.warn('⚠️ Incomplete JSON, adding closing brackets...');
            const openBraces = (cleaned.match(/\{/g) || []).length;
            const closeBraces = (cleaned.match(/\}/g) || []).length;
            const openBrackets = (cleaned.match(/\[/g) || []).length;
            const closeBrackets = (cleaned.match(/\]/g) || []).length;

            for (let i = 0; i < (openBrackets - closeBrackets); i++) cleaned += ']';
            for (let i = 0; i < (openBraces - closeBraces); i++) cleaned += '}';
        } else {
            cleaned = cleaned.substring(0, matchEnd + 1);
        }

        cleaned = cleaned
            .replace(/,(\s*[}\]])/g, '$1')
            .replace(/[\x00-\x1F\x7F]/g, '');

        try {
            const parsed = JSON.parse(cleaned);
            console.log('✅ JSON parsed successfully');
            return parsed;
        } catch (e) {
            console.log('⚠️ Parse failed, removing newlines...');
            const compacted = cleaned
                .replace(/\n/g, ' ')
                .replace(/\r/g, ' ')
                .replace(/\s+/g, ' ');

            try {
                const parsed = JSON.parse(compacted);
                console.log('✅ JSON parsed after cleanup');
                return parsed;
            } catch (e2) {
                console.error('❌ JSON parse failed even after cleanup');
                console.error('First 500 chars:', cleaned.substring(0, 500));
                throw new Error('Failed to parse JSON from AI response');
            }
        }
    }

    private findJsonStart(text: string): number {
        const braceIndex = text.indexOf('{');
        const bracketIndex = text.indexOf('[');

        if (braceIndex === -1 && bracketIndex === -1) return -1;
        if (braceIndex === -1) return bracketIndex;
        if (bracketIndex === -1) return braceIndex;
        return Math.min(braceIndex, bracketIndex);
    }

    private findMatchingBracket(str: string, start: number, openChar: string, closeChar: string): number {
        let depth = 0;
        let inString = false;
        let escapeNext = false;

        for (let i = start; i < str.length; i++) {
            const char = str[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"' && !inString) {
                inString = true;
                continue;
            }

            if (char === '"' && inString) {
                inString = false;
                continue;
            }

            if (!inString) {
                if (char === openChar) depth++;
                else if (char === closeChar) {
                    depth--;
                    if (depth === 0) return i;
                }
            }
        }

        return -1;
    }

    /**
     * Test connection
     */
    async test(): Promise<void> {
        console.log('🔗 Testing Sarvam AI...');

        try {
            const response = await this.client.chat.completions({
                messages: [
                    { role: "user", content: "Reply with: OK" }
                ],
                //@ts-ignore
                model: "sarvam-m",
                max_tokens: 10,
                temperature: 0.1
            });

            const content = response.choices?.[0]?.message?.content;
            console.log('✅ Sarvam AI connected:', content);
        } catch (error: any) {
            console.error('❌ Sarvam AI test failed:', error.message);
            throw error;
        }
    }
}

export const sarvam = new SarvamClient();