/**
 * Cohere API Configuration
 * Using command-a-03-2025 model
 */

import { CohereClientV2 } from 'cohere-ai';

interface CohereResponse {
    message: {
        content: Array<{
            type: string;
            text?: string;
        }>;
    };
    usage?: {
        tokens: {
            input_tokens: number;
            output_tokens: number;
        };
    };
}

class CohereClient {
    private client: CohereClientV2;
    private model: string = 'command-a-03-2025';

    constructor() {
        const apiKey = process.env.COHERE_API_KEY || '';
        if (!apiKey) {
            throw new Error('COHERE_API_KEY is not set in environment variables');
        }

        this.client = new CohereClientV2({
            token: apiKey,
        });
    }

    /**
     * Generate JSON response using Cohere chat
     */
    async json(systemPrompt: string, userInput: string, options?: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<any> {
        const model = options?.model || this.model;
        const temperature = options?.temperature ?? 0.7;
        const maxTokens = options?.maxTokens ?? 8000;

        console.log('🤖 Cohere API Request:', {
            model,
            temperature,
            maxTokens
        });

        try {
            const response = await this.client.chat({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt,
                    },
                    {
                        role: 'user',
                        content: userInput,
                    },
                ],
                temperature: temperature,
                maxTokens: maxTokens,
            });

            console.log('✅ Cohere response received:', {
                tokens: response.usage?.tokens,
            });

            // Extract text content from response
            const content = response.message?.content;
            if (!content || content.length === 0) {
                throw new Error('No content in Cohere response');
            }

            const textContent = content.find(c => c.type === 'text')?.text;
            if (!textContent) {
                throw new Error('No text content in Cohere response');
            }

            console.log('📊 Response preview:', textContent.substring(0, 200) + '...');

            // Parse JSON from response
            return this.extractAndParseJSON(textContent);

        } catch (error: any) {
            console.error('❌ Cohere API Error:', error.message);
            throw error;
        }
    }

    /**
     * Extract and parse JSON from response text
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
                    console.error('🔥 All strategies failed. Logging raw response (first 500 chars):');
                    console.error(jsonStr.substring(0, 500));
                    console.error('... (truncated)');
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
     * Brute force: Fix incomplete JSON (e.g., from token limit truncation)
     */
    private parseWithBruteForce(jsonStr: string): any {
        console.log('🔨 Attempting brute force JSON repair...');

        let fixed = jsonStr.trim();

        // If it starts with array, try to close it properly
        if (fixed.startsWith('[')) {
            // Find the last valid complete object
            let depth = 0;
            let inString = false;
            let escape = false;
            let lastValidPos = -1;

            for (let i = 0; i < fixed.length; i++) {
                const char = fixed[i];

                if (escape) {
                    escape = false;
                    continue;
                }

                if (char === '\\') {
                    escape = true;
                    continue;
                }

                if (char === '"' && !escape) {
                    inString = !inString;
                    continue;
                }

                if (!inString) {
                    if (char === '{' || char === '[') {
                        depth++;
                    } else if (char === '}' || char === ']') {
                        depth--;
                        if (depth === 1 && char === '}') {
                            // Found a complete object inside the array
                            lastValidPos = i;
                        }
                    }
                }
            }

            // If we found a complete object, truncate after it and close the array
            if (lastValidPos > 0) {
                fixed = fixed.substring(0, lastValidPos + 1) + ']';
                console.log(`🔧 Truncated to last valid object at position ${lastValidPos}`);
            }
        }

        try {
            const result = JSON.parse(fixed);
            console.log(`✅ Brute force succeeded! Recovered ${Array.isArray(result) ? result.length : 'N/A'} items`);
            return result;
        } catch (e: any) {
            throw new Error(`Brute force failed: ${e.message}`);
        }
    }

    /**
     * Test API connection
     */
    async test(): Promise<void> {
        console.log('🔗 Testing Cohere API connection...');

        try {
            const response = await this.client.chat({
                model: this.model,
                messages: [
                    {
                        role: 'user',
                        content: 'Reply with: OK',
                    },
                ],
                maxTokens: 10,
            });

            const content = response.message?.content;
            const textContent = content?.find(c => c.type === 'text')?.text || '';
            console.log('✅ Cohere API connected:', textContent);
        } catch (error: any) {
            throw new Error(`Cohere test failed: ${error.message}`);
        }
    }
}

export const cohere = new CohereClient();
