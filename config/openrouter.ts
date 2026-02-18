/**
 * OpenRouter API Configuration
 * Using arcee-ai/trinity-large-preview:free model
 * Enhanced JSON parsing with HTML quote handling
 */

interface OpenRouterResponse {
    choices: Array<{
        message: {
            content: string;
            reasoning_details?: unknown;
        };
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

class OpenRouterClient {
    private apiKey: string;
    private baseUrl: string = 'https://openrouter.ai/api/v1';
    private model: string = 'arcee-ai/trinity-large-preview:free';

    constructor() {
        this.apiKey = process.env.OPENROUTER_API_KEY || '';
        if (!this.apiKey) {
            throw new Error('OPENROUTER_API_KEY is not set in environment variables');
        }
    }

    /**
     * Generate JSON response with robust HTML handling
     */
    async json(systemPrompt: string, userInput: string, options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<any> {
        const model = options?.model || this.model;
        const temperature = options?.temperature ?? 0.7;
        const maxTokens = options?.maxTokens ?? 8000;

        console.log('🤖 OpenRouter API Request:', {
            model,
            temperature,
            maxTokens
        });

        const combinedPrompt = `${systemPrompt}\n\nUSER REQUEST:\n${userInput}\n\n---
CRITICAL OUTPUT RULES:
1. Return ONLY valid JSON (array or object)
2. In HTML fields, use SINGLE QUOTES for all attributes: style='color: white'
3. DO NOT use double quotes inside HTML: style="color: white" ❌
4. Example: <div style='background: #111827; padding: 20px;'>
5. No markdown code blocks, no explanations, just pure JSON
6. Ensure all JSON strings are properly escaped`;

        const requestBody = {
            model: model,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: userInput + "\n\n" + combinedPrompt
                }
            ],
            temperature: temperature,
            max_tokens: maxTokens
        };

        try {
            const url = `${this.baseUrl}/chat/completions`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://ai-video-course-generator.vercel.app',
                    'X-Title': 'AI Video Course Generator'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ OpenRouter API Error:', errorText);
                throw new Error(`OpenRouter API failed: ${response.status} - ${errorText}`);
            }

            const data: OpenRouterResponse = await response.json();

            if (!data.choices || data.choices.length === 0) {
                console.error('❌ No choices in response:', data);
                throw new Error('No choices array in OpenRouter response');
            }

            if (!data.choices[0]?.message) {
                console.error('❌ No message in first choice:', data.choices[0]);
                throw new Error('No message in OpenRouter response');
            }

            if (!data.choices[0].message.content) {
                console.error('❌ No content in message:', data.choices[0].message);
                throw new Error('No content in OpenRouter response');
            }

            const rawText = data.choices[0].message.content;

            console.log('✅ OpenRouter response received:', {
                length: rawText.length,
                tokens: data.usage?.total_tokens,
                preview: rawText.substring(0, 200) + '...'
            });

            // Parse JSON from response
            return this.extractAndParseJSON(rawText);

        } catch (error: any) {
            console.error('❌ OpenRouter API Error:', error.message);
            throw error;
        }
    }

    /**
     * Extract and parse JSON with smart HTML handling
     */
    private extractAndParseJSON(text: string): any {
        console.log('🔧 Extracting JSON from response...');

        let cleaned = text.trim();

        // Remove markdown code blocks
        cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');

        // Find JSON boundaries
        const arrayStart = cleaned.indexOf('[');
        const objectStart = cleaned.indexOf('{');

        let jsonStart = -1;
        if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
            jsonStart = arrayStart;
        } else if (objectStart !== -1) {
            jsonStart = objectStart;
        }

        if (jsonStart === -1) {
            throw new Error('No JSON found in response');
        }

        let jsonStr = cleaned.substring(jsonStart).trim();

        // Try progressive parsing strategies
        const strategies = [
            () => JSON.parse(jsonStr),
            () => this.parseWithHtmlFix(jsonStr),
            () => this.parseWithSmartQuoteEscape(jsonStr),
            () => this.parseWithBruteForce(jsonStr),
        ];

        for (let i = 0; i < strategies.length; i++) {
            try {
                console.log(`📝 Attempting parse strategy ${i + 1}/${strategies.length}...`);
                const result = strategies[i]();
                console.log(`✅ Parse strategy ${i + 1} succeeded!`);
                return result;
            } catch (e: any) {
                console.warn(`⚠️ Strategy ${i + 1} failed:`, e.message);
                if (i === strategies.length - 1) {
                    throw new Error(`All parse strategies failed. Last error: ${e.message}`);
                }
            }
        }
    }

    /**
     * Parse JSON with HTML quote fixing
     */
    private parseWithHtmlFix(jsonStr: string): any {
        console.log('🔧 Attempting HTML quote fix...');

        let fixed = jsonStr;

        // Find all "html" fields and fix quotes inside them
        const htmlFieldRegex = /"html":\s*"((?:[^"\\]|\\.)*)"/g;

        fixed = fixed.replace(htmlFieldRegex, (match, htmlContent) => {
            let fixedHtml = htmlContent;
            // Fix common HTML attribute patterns: style="..." -> style='...'
            fixedHtml = fixedHtml.replace(/(<[^>]+\s+\w+)="([^"]*?)"/g, "$1='$2'");
            return `"html": "${fixedHtml}"`;
        });

        return JSON.parse(fixed);
    }

    /**
     * Parse with smart quote escaping
     */
    private parseWithSmartQuoteEscape(jsonStr: string): any {
        console.log('🔧 Attempting smart quote escape...');

        let fixed = jsonStr;

        // Remove trailing commas
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

        // Fix common JSON issues
        fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

        return JSON.parse(fixed);
    }

    /**
     * Brute force: Extract valid JSON by finding matching brackets
     */
    private parseWithBruteForce(jsonStr: string): any {
        console.log('🔨 Attempting brute force JSON extraction...');

        let depth = 0;
        let inString = false;
        let escape = false;
        let jsonContent = '';

        for (let i = 0; i < jsonStr.length; i++) {
            const char = jsonStr[i];

            if (escape) {
                jsonContent += char;
                escape = false;
                continue;
            }

            if (char === '\\') {
                escape = true;
                jsonContent += char;
                continue;
            }

            if (char === '"' && !escape) {
                inString = !inString;
                jsonContent += char;
                continue;
            }

            if (!inString) {
                if (char === '[' || char === '{') {
                    depth++;
                } else if (char === ']' || char === '}') {
                    depth--;
                }
            }

            jsonContent += char;

            if (depth === 0 && jsonContent.trim().length > 0) {
                break;
            }
        }

        try {
            return JSON.parse(jsonContent);
        } catch (e) {
            return this.manualExtraction(jsonStr);
        }
    }

    /**
     * Manual extraction as absolute last resort
     */
    private manualExtraction(jsonStr: string): any {
        console.log('🆘 Attempting manual data extraction...');

        const slides: any[] = [];

        // Extract slide objects manually
        const slideRegex = /"slideId":\s*"([^"]+)"[\s\S]*?"slideIndex":\s*(\d+)[\s\S]*?"html":\s*"((?:[^"\\]|\\.)*?)"[\s\S]*?"narration":\s*\{[\s\S]*?"fullText":\s*"((?:[^"\\]|\\.)*?)"[\s\S]*?"revealData":\s*\[(.*?)\]/g;

        let match;
        while ((match = slideRegex.exec(jsonStr)) !== null) {
            const [, slideId, slideIndex, html, narration, revealDataStr] = match;

            const revealData = revealDataStr
                .split(',')
                .map(s => s.trim().replace(/"/g, ''))
                .filter(Boolean);

            slides.push({
                slideId,
                slideIndex: parseInt(slideIndex),
                html: html.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
                narration: {
                    fullText: narration.replace(/\\n/g, '\n').replace(/\\"/g, '"')
                },
                revealData
            });
        }

        if (slides.length === 0) {
            throw new Error('Could not extract any slides from response');
        }

        console.log(`✅ Manually extracted ${slides.length} slides`);
        return slides;
    }

    /**
     * Test API connection
     */
    async test(): Promise<void> {
        console.log('🔗 Testing OpenRouter API with arcee-ai/trinity-large-preview:free...');

        const url = `${this.baseUrl}/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://ai-video-course-generator.vercel.app',
                'X-Title': 'AI Video Course Generator'
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        role: 'user',
                        content: 'Reply with: OK'
                    }
                ],
                max_tokens: 10
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter test failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('✅ OpenRouter API connected:', data.choices[0].message.content);
    }
}

export const openrouter = new OpenRouterClient();