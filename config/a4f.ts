/**
 * A4F API Configuration
 * High-quality AI content generation using multiple providers
 */

interface A4FMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface A4FRequestBody {
    model: string;
    messages: A4FMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
}

class A4FClient {
    private apiKey: string;
    private baseUrl: string = 'https://api.a4f.co/v1';

    constructor() {
        this.apiKey = process.env.A4F_API_KEY || '';
        if (!this.apiKey) {
            throw new Error('A4F_API_KEY is not set in environment variables');
        }
    }

    /**
     * Generate JSON response from A4F API
     * Uses Claude 3.5 Sonnet for highest quality outputs
     */
    async json(systemPrompt: string, userInput: string, options?: {
        model?: string;
        temperature?: number;
        max_tokens?: number;
    }): Promise<any> {
        const model = options?.model || 'provider-2/deepseek-r1-0528t'; // Claude 3.5 Sonnet
        const temperature = options?.temperature ?? 0.85;
        const max_tokens = options?.max_tokens ?? 16000;

        console.log('🤖 A4F API Request:', {
            model,
            temperature,
            max_tokens,
            systemPromptLength: systemPrompt.length,
            userInputLength: userInput.length
        });

        const requestBody: A4FRequestBody = {
            model,
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: userInput
                }
            ],
            temperature,
            max_tokens
        };

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to parse error JSON' }));
                throw new Error(`A4F API request failed with status ${response.status}: ${JSON.stringify(errorData)}`);
            }

            const data = await response.json();

            if (!data.choices || data.choices.length === 0) {
                throw new Error('No choices found in A4F API response');
            }

            const content = data.choices[0].message?.content;
            if (!content) {
                throw new Error('No content in A4F API response');
            }

            console.log('✅ A4F API Response received:', {
                model: data.model,
                tokensUsed: data.usage?.total_tokens,
                contentLength: content.length
            });

            // Parse JSON from response
            // Remove markdown code blocks if present
            let cleanContent = content.trim();
            if (cleanContent.startsWith('```json')) {
                cleanContent = cleanContent.replace(/^```json\n?/, '').replace(/\n?```$/, '');
            } else if (cleanContent.startsWith('```')) {
                cleanContent = cleanContent.replace(/^```\n?/, '').replace(/\n?```$/, '');
            }

            return JSON.parse(cleanContent);

        } catch (error: any) {
            console.error('❌ A4F API Error:', error.message);
            throw error;
        }
    }

    /**
     * Test API connection
     */
    async test(): Promise<void> {
        console.log('🔗 Testing A4F API connection...');

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'provider-2/deepseek-r1-0528',
                messages: [
                    { role: 'user', content: 'Reply with just "OK" if you can read this.' }
                ],
                max_tokens: 10
            })
        });

        if (!response.ok) {
            throw new Error(`A4F API test failed with status ${response.status}`);
        }

        console.log('✅ A4F API connection test successful');
    }
}

// Export singleton instance
export const a4f = new A4FClient();