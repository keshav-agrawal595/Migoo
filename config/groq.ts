// config/groq.ts
interface GroqChatMessage {
    role: 'system' | 'user' | 'assistant' | 'developer';
    content: string;
}

interface GroqChatCompletionParams {
    model: string;
    messages: GroqChatMessage[];
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stream?: boolean;
    stop?: string | string[];
    response_format?: {
        type: 'text' | 'json_object';
    };
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

/**
 * Groq API Client - No SDK required
 */
class GroqClient {
    private apiKey: string;
    private baseURL: string = 'https://api.groq.com/openai/v1';

    constructor() {
        this.apiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY || '';

        if (!this.apiKey) {
            console.error('❌ ERROR: NEXT_PUBLIC_GROQ_API_KEY is not set in environment variables');
            throw new Error('Groq API key is required. Set NEXT_PUBLIC_GROQ_API_KEY environment variable.');
        }
    }

    /**
     * Create a chat completion with Groq API
     */
    async createChatCompletion(
        messages: GroqChatMessage[],
        options: {
            model?: string;
            temperature?: number;
            max_tokens?: number;
            response_format?: 'text' | 'json_object';
        } = {}
    ): Promise<GroqChatCompletionResponse> {
        const {
            model = 'openai/gpt-oss-120b', // Default to GPT OSS 120B
            temperature = 0.7,
            max_tokens = 2048,
            response_format = 'text'
        } = options;

        const params: GroqChatCompletionParams = {
            model,
            messages,
            temperature,
            max_tokens,
            response_format: response_format === 'json_object' ? { type: 'json_object' } : undefined,
        };

        console.log('🚀 Calling Groq API with:', {
            model: params.model,
            temperature: params.temperature,
            max_tokens: params.max_tokens,
            response_format: params.response_format,
            messageCount: messages.length
        });

        try {
            console.log('📤 Sending request to Groq API...');
            const startTime = Date.now();

            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(params),
            });

            const endTime = Date.now();
            const responseTime = endTime - startTime;

            console.log(`⏱️  Response time: ${responseTime}ms`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Groq API Error Response:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                });

                // Try to parse error JSON
                try {
                    const errorData = JSON.parse(errorText);
                    throw new Error(`Groq API Error ${response.status}: ${errorData.error?.message || response.statusText}`);
                } catch {
                    throw new Error(`Groq API Error ${response.status}: ${response.statusText}`);
                }
            }

            const data = await response.json();

            console.log('✅ Groq API Success:', {
                model: data.model,
                id: data.id,
                finish_reason: data.choices[0]?.finish_reason,
                tokens: {
                    prompt: data.usage?.prompt_tokens,
                    completion: data.usage?.completion_tokens,
                    total: data.usage?.total_tokens
                }
            });

            console.log('📝 Raw response content:', data.choices[0]?.message?.content);

            return data as GroqChatCompletionResponse;
        } catch (error: any) {
            console.error('🔥 Groq API Request Failed:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Simple chat with system and user messages
     */
    async simpleChat(
        systemPrompt: string,
        userMessage: string,
        options?: {
            model?: string;
            temperature?: number;
            max_tokens?: number;
            response_format?: 'text' | 'json_object';
        }
    ): Promise<string> {
        const messages: GroqChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ];

        console.log('💬 Simple chat request:', {
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length,
            options
        });

        const response = await this.createChatCompletion(messages, options);
        return response.choices[0]?.message?.content || '';
    }

    /**
     * Create a chat completion that returns JSON object
     */
    async createJSONChat<T = any>(
        systemPrompt: string,
        userMessage: string,
        options?: {
            model?: string;
            temperature?: number;
            max_tokens?: number;
        }
    ): Promise<T> {
        console.log('📊 JSON chat request:', {
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length
        });

        const response = await this.simpleChat(systemPrompt, userMessage, {
            ...options,
            response_format: 'json_object'
        });

        console.log('📦 Raw JSON response:', response);

        try {
            const parsed = JSON.parse(response);
            console.log('✅ JSON parsed successfully:', {
                type: typeof parsed,
                keys: Object.keys(parsed)
            });
            return parsed as T;
        } catch (error: any) {
            console.error('❌ Failed to parse JSON response:', {
                error: error.message,
                response: response.substring(0, 200) + '...'
            });
            throw new Error(`Invalid JSON response from Groq API: ${error.message}`);
        }
    }

    /**
     * Validate API key by making a simple request
     */
    async validateAPIKey(): Promise<boolean> {
        console.log('🔑 Validating Groq API key...');

        try {
            const response = await fetch(`${this.baseURL}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            });

            const isValid = response.ok;
            console.log(isValid ? '✅ API Key is valid' : '❌ API Key is invalid');
            return isValid;
        } catch (error) {
            console.error('❌ API Key validation failed:', error);
            return false;
        }
    }

    /**
     * Test the API with a simple request
     */
    async testConnection(): Promise<void> {
        console.log('🧪 Testing Groq API connection...');

        try {
            const isValid = await this.validateAPIKey();
            if (!isValid) {
                throw new Error('API key validation failed');
            }

            console.log('🔄 Making test chat request...');
            const testResponse = await this.simpleChat(
                'You are a helpful assistant. Respond with "API is working!"',
                'Test connection',
                { max_tokens: 10 }
            );

            console.log('🎉 Groq API Test Successful!');
            console.log('Test response:', testResponse);
        } catch (error: any) {
            console.error('💥 Groq API Test Failed:', error.message);
            throw error;
        }
    }
}

// Create and export a singleton instance
let groqInstance: GroqClient | null = null;

export function getGroqClient(): GroqClient {
    if (!groqInstance) {
        groqInstance = new GroqClient();
    }
    return groqInstance;
}

// Export the client class and helper functions
export const groq = {
    getClient: getGroqClient,

    /**
     * Create a chat completion
     */
    async chat(messages: GroqChatMessage[], options?: any) {
        const client = getGroqClient();
        return client.createChatCompletion(messages, options);
    },

    /**
     * Simple chat with system and user messages
     */
    async simple(systemPrompt: string, userMessage: string, options?: any) {
        const client = getGroqClient();
        return client.simpleChat(systemPrompt, userMessage, options);
    },

    /**
     * Get JSON response
     */
    async json<T = any>(systemPrompt: string, userMessage: string, options?: any) {
        const client = getGroqClient();
        return client.createJSONChat<T>(systemPrompt, userMessage, options);
    },

    /**
     * Test the API connection
     */
    async test() {
        const client = getGroqClient();
        return client.testConnection();
    }
};