/**
 * Google Gemini API Configuration
 * Enhanced JSON parsing with HTML quote handling
 */

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}

class GeminiClient {
    private apiKey: string;
    private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta';

    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY || '';
        if (!this.apiKey) {
            throw new Error('GEMINI_API_KEY is not set in environment variables');
        }
    }

    /**
     * Generate JSON response with robust HTML handling
     */
    async json(systemPrompt: string, userInput: string, options?: {
        model?: string;
        temperature?: number;
        maxOutputTokens?: number;
    }): Promise<any> {
        const model = options?.model || 'gemini-2.5-flash';
        const temperature = options?.temperature ?? 0.7;
        const maxOutputTokens = options?.maxOutputTokens ?? 65536;

        console.log('🤖 Gemini API Request:', {
            model,
            temperature,
            maxOutputTokens
        });

        const combinedPrompt = `${systemPrompt}\n\nUSER REQUEST:\n${userInput}\n\n---\nIMPORTANT OUTPUT RULES:
1. Return ONLY a valid JSON array
2. In the "html" field, use SINGLE QUOTES for HTML attributes (NOT double quotes)
3. Example: <body style='background: #111827'> instead of <body style="background: #111827">
4. This avoids JSON escaping issues
5. No markdown, no code blocks, just pure JSON`;

        const requestBody = {
            contents: [
                {
                    parts: [
                        {
                            text: combinedPrompt
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature,
                maxOutputTokens
            }
        };

        try {
            const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Gemini API Error:', errorText);
                throw new Error(`Gemini API failed: ${response.status}`);
            }

            const data: GeminiResponse = await response.json();

            if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                throw new Error('No content in Gemini response');
            }

            const rawText = data.candidates[0].content.parts[0].text;

            console.log('✅ Gemini response received:', {
                length: rawText.length,
                tokens: data.usageMetadata?.totalTokenCount
            });

            // Parse JSON from response
            return this.extractAndParseJSON(rawText);

        } catch (error: any) {
            console.error('❌ Gemini API Error:', error.message);
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

        // Strategy: Find "html" fields and fix quotes inside them
        let fixed = jsonStr;

        // Find all "html": "..." patterns
        const htmlFieldRegex = /"html":\s*"((?:[^"\\]|\\.)*)"/g;

        fixed = fixed.replace(htmlFieldRegex, (match, htmlContent) => {
            // Inside HTML content, convert " to ' for attributes
            let fixedHtml = htmlContent;

            // Fix common HTML attribute patterns
            // style="..." -> style='...'
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

        // Try to parse what we can get
        return JSON.parse(fixed);
    }

    /**
     * Brute force: Extract valid JSON by finding matching brackets
     */
    private parseWithBruteForce(jsonStr: string): any {
        console.log('🔨 Attempting brute force JSON extraction...');

        // Find the actual JSON structure by tracking brackets
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
                // We've found a complete JSON structure
                break;
            }
        }

        // Try to parse the extracted content
        try {
            return JSON.parse(jsonContent);
        } catch (e) {
            // Last resort: Try to manually extract slide data
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

            // Parse reveal data
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
        console.log('🔗 Testing Gemini API...');

        const url = `${this.baseUrl}/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: 'Reply with: OK' }
                        ]
                    }
                ],
                generationConfig: {
                    maxOutputTokens: 10
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini test failed: ${response.status}`);
        }

        console.log('✅ Gemini API connected');
    }
}

export const gemini = new GeminiClient();