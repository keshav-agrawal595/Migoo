// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED GROQ API CLIENT
// Optimized for large prompts, perfect JSON parsing, fast response times
// ═══════════════════════════════════════════════════════════════════════════════

interface GroqChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface GroqChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

interface JSONParseStrategy {
    name: string;
    parser: (text: string) => any;
}

/**
 * Enhanced Groq Client for Video Course Generation
 */
class EnhancedGroqClient {
    private apiKey: string;
    private baseURL: string = 'https://api.groq.com/openai/v1';

    // Best models for different tasks
    private models = {
        // Fast, high-quality model for large content generation
        primary: 'llama-3.3-70b-versatile',
        // Fallback if primary fails
        fallback: 'llama-3.1-70b-versatile',
        // For testing
        test: 'llama-3.3-70b-versatile'
    };

    constructor() {
        this.apiKey = process.env.GROQ_API_KEY || '';

        if (!this.apiKey) {
            throw new Error('NEXT_PUBLIC_GROQ_API_KEY is required');
        }
    }

    /**
     * Generate slides with bulletproof JSON parsing
     */
    async generateSlides(
        systemPrompt: string,
        userInput: string,
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
        }
    ): Promise<any> {
        const model = options?.model || this.models.primary;
        const temperature = options?.temperature ?? 0.7;
        const maxTokens = options?.maxTokens ?? 8000;

        console.log('\n' + '═'.repeat(80));
        console.log('🤖 GROQ API REQUEST');
        console.log('═'.repeat(80));
        console.log('Model:', model);
        console.log('Temperature:', temperature);
        console.log('Max Tokens:', maxTokens);
        console.log('System Prompt:', systemPrompt.length, 'chars');
        console.log('User Input:', userInput.length, 'chars');
        console.log('═'.repeat(80));

        const messages: GroqChatMessage[] = [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: userInput
            }
        ];

        try {
            const startTime = Date.now();

            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: temperature,
                    max_tokens: maxTokens,
                    top_p: 1,
                    stream: false
                }),
                signal: AbortSignal.timeout(180000) // 3 minute timeout
            });

            const endTime = Date.now();
            const responseTime = ((endTime - startTime) / 1000).toFixed(2);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Groq API Error:', errorText);
                throw new Error(`Groq API failed (${response.status}): ${errorText}`);
            }

            const data: GroqChatCompletionResponse = await response.json();

            console.log('✅ Response received in', responseTime, 'seconds');
            console.log('📊 Tokens:', {
                prompt: data.usage.prompt_tokens,
                completion: data.usage.completion_tokens,
                total: data.usage.total_tokens
            });

            if (!data.choices?.[0]?.message?.content) {
                throw new Error('No content in Groq response');
            }

            const rawContent = data.choices[0].message.content;
            console.log('📝 Raw response length:', rawContent.length, 'chars');
            console.log('📝 Response preview:', rawContent.substring(0, 200).replace(/\n/g, ' ') + '...');

            // Parse JSON with advanced strategies
            const parsed = await this.advancedJSONParse(rawContent);

            console.log('✅ JSON parsed successfully');
            console.log('═'.repeat(80) + '\n');

            return parsed;

        } catch (error: any) {
            console.error('❌ Groq API Error:', error.message);
            throw error;
        }
    }

    /**
     * Advanced JSON parsing with 8 fallback strategies
     */
    private async advancedJSONParse(text: string): Promise<any> {
        console.log('🔧 Advanced JSON parsing...');

        let cleaned = text.trim();

        // Remove markdown code blocks
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
        cleaned = cleaned.replace(/```\s*$/i, '');
        cleaned = cleaned.trim();

        // Define parsing strategies
        const strategies: JSONParseStrategy[] = [
            {
                name: 'Direct Parse',
                parser: (t: string) => JSON.parse(t)
            },
            {
                name: 'Extract Boundaries',
                parser: (t: string) => this.extractJSONBoundaries(t)
            },
            {
                name: 'Fix HTML Quotes',
                parser: (t: string) => this.fixHTMLQuotes(t)
            },
            {
                name: 'Fix Trailing Commas',
                parser: (t: string) => this.fixTrailingCommas(t)
            },
            {
                name: 'Fix Escaping',
                parser: (t: string) => this.fixEscaping(t)
            },
            {
                name: 'Aggressive Cleanup',
                parser: (t: string) => this.aggressiveCleanup(t)
            },
            {
                name: 'Balance Brackets',
                parser: (t: string) => this.balanceBrackets(t)
            },
            {
                name: 'Manual Extraction',
                parser: (t: string) => this.manualExtraction(t)
            }
        ];

        // Try each strategy
        for (let i = 0; i < strategies.length; i++) {
            const strategy = strategies[i];

            try {
                console.log(`📝 Strategy ${i + 1}/${strategies.length}: ${strategy.name}`);
                const result = strategy.parser(cleaned);

                if (this.isValidParsedJSON(result)) {
                    console.log(`✅ Success with ${strategy.name}`);
                    return result;
                } else {
                    console.warn(`⚠️ ${strategy.name} produced invalid structure`);
                }

            } catch (error: any) {
                console.warn(`⚠️ ${strategy.name} failed: ${error.message.substring(0, 80)}`);

                if (i === strategies.length - 1) {
                    console.error('❌ All strategies failed');
                    console.error('First 500 chars:', cleaned.substring(0, 500));
                    console.error('Last 200 chars:', cleaned.substring(Math.max(0, cleaned.length - 200)));
                    throw new Error(`All ${strategies.length} parsing strategies failed`);
                }
            }
        }

        throw new Error('JSON parsing failed');
    }

    /**
     * Strategy 1: Extract JSON boundaries
     */
    private extractJSONBoundaries(text: string): any {
        const arrayStart = text.indexOf('[');
        const objectStart = text.indexOf('{');

        let startIdx = -1;
        if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
            startIdx = arrayStart;
        } else if (objectStart !== -1) {
            startIdx = objectStart;
        }

        if (startIdx === -1) {
            throw new Error('No JSON start found');
        }

        const extracted = text.substring(startIdx);
        return JSON.parse(extracted);
    }

    /**
     * Strategy 2: Fix HTML quotes
     */
    private fixHTMLQuotes(text: string): any {
        let fixed = text;

        // Fix "html": "..." fields
        const htmlFieldRegex = /"html":\s*"((?:[^"\\]|\\.)*)"/g;

        fixed = fixed.replace(htmlFieldRegex, (match, htmlContent) => {
            let fixedHtml = htmlContent;
            // Convert double quotes in attributes to single quotes
            fixedHtml = fixedHtml.replace(/\s+([\w-]+)="([^"]*)"/g, ' $1=\'$2\'');
            return `"html": "${fixedHtml}"`;
        });

        return JSON.parse(fixed);
    }

    /**
     * Strategy 3: Fix trailing commas
     */
    private fixTrailingCommas(text: string): any {
        let fixed = text
            .replace(/,(\s*[\]}])/g, '$1')
            .replace(/,(\s*$)/g, '');

        return JSON.parse(fixed);
    }

    /**
     * Strategy 4: Fix escaping
     */
    private fixEscaping(text: string): any {
        let fixed = text
            .replace(/([^\\])\n/g, '$1\\n')
            .replace(/\t/g, '\\t');

        return JSON.parse(fixed);
    }

    /**
     * Strategy 5: Aggressive cleanup
     */
    private aggressiveCleanup(text: string): any {
        let fixed = text
            .split('\n')
            .map(line => line.trim())
            .join(' ')
            .replace(/\s+/g, ' ')
            .replace(/,(\s*[\]}])/g, '$1')
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        return JSON.parse(fixed);
    }

    /**
     * Strategy 6: Balance brackets
     */
    private balanceBrackets(text: string): any {
        let fixed = text.trim();

        const openBraces = (fixed.match(/\{/g) || []).length;
        const closeBraces = (fixed.match(/\}/g) || []).length;
        const openBrackets = (fixed.match(/\[/g) || []).length;
        const closeBrackets = (fixed.match(/\]/g) || []).length;

        for (let i = 0; i < (openBrackets - closeBrackets); i++) fixed += ']';
        for (let i = 0; i < (openBraces - closeBraces); i++) fixed += '}';

        console.log(`   Balanced: +${openBrackets - closeBrackets} ], +${openBraces - closeBraces} }`);

        return JSON.parse(fixed);
    }

    /**
     * Strategy 7: Manual extraction
     */
    private manualExtraction(text: string): any {
        console.log('🆘 Manual extraction...');

        const slides: any[] = [];
        const slidePattern = /\{[^{}]*"slideId"[^{}]*"slideIndex"[^{}]*"html"[^{}]*"narration"[^{}]*"revealData"[^{}]*\}/g;

        const matches = text.match(slidePattern);

        if (!matches || matches.length === 0) {
            throw new Error('Manual extraction found no slides');
        }

        for (const match of matches) {
            try {
                const slide = JSON.parse(match);
                slides.push(slide);
            } catch (e) {
                console.warn('   Failed to parse extracted slide');
            }
        }

        if (slides.length === 0) {
            throw new Error('Manual extraction parsed no valid slides');
        }

        console.log(`   Extracted ${slides.length} slides`);
        return slides;
    }

    /**
     * Validate parsed JSON
     */
    private isValidParsedJSON(result: any): boolean {
        if (!result) return false;

        const slides = Array.isArray(result) ? result : [result];

        if (slides.length === 0) return false;

        const firstSlide = slides[0];

        return Boolean(
            firstSlide.slideId &&
            firstSlide.slideIndex !== undefined &&
            firstSlide.html &&
            firstSlide.narration?.fullText &&
            Array.isArray(firstSlide.revealData)
        );
    }

    /**
     * Test API connection
     */
    async test(): Promise<void> {
        console.log('🔗 Testing Groq API...');

        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.models.test,
                    messages: [
                        {
                            role: 'user',
                            content: 'Reply with: {"status": "OK"}'
                        }
                    ],
                    max_tokens: 50
                }),
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                throw new Error(`Test failed: ${response.status}`);
            }

            const data = await response.json();
            console.log('✅ Groq API connected');
            console.log('Response:', data.choices[0].message.content.substring(0, 100));

        } catch (error: any) {
            console.error('❌ Groq test failed:', error.message);
            throw error;
        }
    }
}

// Export singleton instance
let groqInstance: EnhancedGroqClient | null = null;

export function getGroqClient(): EnhancedGroqClient {
    if (!groqInstance) {
        groqInstance = new EnhancedGroqClient();
    }
    return groqInstance;
}

// Export convenient wrapper
export const groq = {
    /**
     * Generate slides (main method)
     */
    async generateSlides(
        systemPrompt: string,
        userInput: string,
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
        }
    ) {
        const client = getGroqClient();
        return client.generateSlides(systemPrompt, userInput, options);
    },

    /**
     * Test connection
     */
    async test() {
        const client = getGroqClient();
        return client.test();
    }
};