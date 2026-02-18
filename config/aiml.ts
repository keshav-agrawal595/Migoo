/**
 * AIML API Configuration
 * Using google/gemma-3-12b-it model
 * Enhanced JSON parsing with robust error handling
 */

interface AIMLResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

class AIMLClient {
    private apiKey: string;
    private baseUrl: string = 'https://api.aimlapi.com/v1';
    private model: string = 'baidu/ernie-4.5-0.3b';

    constructor() {
        this.apiKey = process.env.AI_ML_API_KEY || '';
        if (!this.apiKey) {
            throw new Error('AI_ML_API_KEY is not set in environment variables');
        }
    }

    /**
     * Generate JSON response with robust error handling
     */
    async json(systemPrompt: string, userInput: string, options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<any> {
        const model = options?.model || this.model;
        const temperature = options?.temperature ?? 0.7;
        const maxTokens = options?.maxTokens ?? 8000;

        console.log('🤖 AIML API Request:', {
            model,
            temperature,
            maxTokens
        });

        // Enhanced prompt to ensure clean JSON output with complete generation
        const combinedPrompt = `${systemPrompt}\n\nUSER REQUEST:\n${userInput}\n\n---
CRITICAL OUTPUT RULES:
1. Generate EXACTLY 6-7 SLIDES (minimum 6, maximum 7) - DO NOT STOP EARLY
2. EACH slide MUST have 2000-2700 words of narration - NO EXCEPTIONS
3. Return ONLY valid JSON array format
4. In HTML fields, use SINGLE QUOTES for all attributes: style='color: white'
5. DO NOT use double quotes inside HTML: style="color: white" ❌
6. Example: <div style='background: #111827; padding: 20px;'>
7. No markdown code blocks, no explanations, just pure JSON
8. Ensure all JSON strings are properly escaped
9. COMPLETE ALL 6-7 SLIDES - continue generating until done`;

        // Note: Baidu ERNIE model only supports 'model' and 'messages' parameters
        // temperature and max_tokens are NOT supported and will cause 400 errors
        const requestBody = {
            model: model,
            messages: [
                {
                    role: "user",
                    content: combinedPrompt
                }
            ]
        };

        try {
            const url = `${this.baseUrl}/chat/completions`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ AIML API Error:', errorText);
                throw new Error(`AIML API failed: ${response.status} - ${errorText}`);
            }

            const data: AIMLResponse = await response.json();

            if (!data.choices || data.choices.length === 0) {
                console.error('❌ No choices in response:', data);
                throw new Error('No choices array in AIML response');
            }

            if (!data.choices[0]?.message) {
                console.error('❌ No message in first choice:', data.choices[0]);
                throw new Error('No message in AIML response');
            }

            if (!data.choices[0].message.content) {
                console.error('❌ No content in message:', data.choices[0].message);
                throw new Error('No content in AIML response');
            }

            const rawText = data.choices[0].message.content;

            console.log('✅ AIML response received:', {
                length: rawText.length,
                tokens: data.usage?.total_tokens,
                preview: rawText.substring(0, 200) + '...'
            });

            // Save response to temp file for debugging if needed
            if (rawText.length > 15000) {
                console.log('💾 Large response detected, saving for debugging...');
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const debugPath = path.join(process.cwd(), 'aiml-debug-response.txt');
                    fs.writeFileSync(debugPath, rawText, 'utf8');
                    console.log(`📁 Debug response saved to: ${debugPath}`);
                } catch (e) {
                    console.warn('⚠️ Could not save debug file:', e);
                }
            }

            // Parse JSON from response
            return this.extractAndParseJSON(rawText);

        } catch (error: any) {
            console.error('❌ AIML API Error:', error.message);
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
            () => this.parseWithQuoteRepair(jsonStr),
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

                // Show context of error location
                if (e.message.includes('position')) {
                    const match = e.message.match(/position (\d+)/);
                    if (match) {
                        const pos = parseInt(match[1]);
                        const start = Math.max(0, pos - 100);
                        const end = Math.min(jsonStr.length, pos + 100);
                        const context = jsonStr.substring(start, end);
                        console.error(`📍 Error context at position ${pos}:`);
                        console.error(context);
                    }
                }

                if (i === strategies.length - 1) {
                    throw new Error(`All parse strategies failed. Last error: ${e.message}`);
                }
            }
        }
    }

    /**
     * Aggressive quote repair for JSON with unescaped quotes
     */
    private parseWithQuoteRepair(jsonStr: string): any {
        console.log('🔧 Attempting aggressive quote repair...');

        let fixed = jsonStr;

        // Strategy 1: Find and fix unescaped quotes inside string values
        // This regex finds: "key": "value with "problem" quotes"
        // and converts to: "key": "value with 'problem' quotes"

        // First, protect already-escaped quotes
        fixed = fixed.replace(/\\"/g, '___ESCAPED_QUOTE___');

        // Fix quotes inside HTML attributes and content
        // Find patterns like: "html": "content with "quotes" here", 
        fixed = fixed.replace(/"(html|narration|fullText)":\s*"((?:[^"]|\\")*?)"/g, (match, key, content) => {
            // Replace any remaining unescaped quotes with single quotes
            const fixedContent = content.replace(/"/g, "'");
            return `"${key}": "${fixedContent}"`;
        });

        // Restore escaped quotes
        fixed = fixed.replace(/___ESCAPED_QUOTE___/g, '\\"');

        // Try to parse
        return JSON.parse(fixed);
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
        console.log('🔗 Testing AIML API with baidu/ernie-4.5-0.3b...');

        const url = `${this.baseUrl}/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        role: 'user',
                        content: 'Reply with: OK'
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`AIML test failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('✅ AIML API connected:', data.choices[0].message.content);
    }
}

export const aiml = new AIMLClient();
