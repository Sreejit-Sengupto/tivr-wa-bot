import Groq from 'groq-sdk';
import { config } from './config.js';
import { type StoredMessage } from './store.js';
import { aiRateLimiter } from './rateLimiter.js';

let groqClient: Groq | null = null;

function getGroqClient(): Groq {
  if (!groqClient) {
    const apiKey = config.groqApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set in environment or .env file');
    }
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

export interface GenerateResponseParams {
  promptQuery: string;
  senderName: string;
  chatHistory: StoredMessage[];
}

/**
 * Generates an AI response using Groq with conversation context from recent messages,
 * respecting Groq RPM rate limits via a sliding-window rate limiter.
 */
export async function generateAIResponse({
  promptQuery,
  senderName,
  chatHistory,
}: GenerateResponseParams): Promise<string> {
  if (!config.groqApiKey && !process.env.GROQ_API_KEY) {
    return '⚠️ [Protone AI] GROQ_API_KEY is not configured in your .env file. Please set GROQ_API_KEY to enable AI replies.';
  }

  try {
    // Acquire rate limit slot (delays if RPM limit is reached in the rolling 60s window)
    await aiRateLimiter.acquire();

    const groq = getGroqClient();

    // Format the past in-memory messages into readable context
    const formattedHistory = chatHistory
      .map((msg) => {
        const time = new Date(msg.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        const roleLabel = msg.role === 'assistant' ? 'Protone (Bot)' : msg.senderName;
        return `[${time}] ${roleLabel}: ${msg.text}`;
      })
      .join('\n');

    const systemPrompt = `You are Protone, a smart, helpful, and concise AI assistant inside a WhatsApp group chat.
You have access to the recent conversation history of the group (up to the past 20 messages).
Use this context to understand references, questions, summaries, or specific tasks requested by the group members.

Guidelines:
1. Always be direct, friendly, and helpful.
2. Keep answers concise and readable for mobile chat unless a detailed explanation is specifically requested.
3. When asked to summarize or reference past discussions, rely accurately on the provided Chat History.

WHATSAPP MESSAGE FORMATTING RULES:
When outputting messages, strictly follow WhatsApp's native text formatting syntax instead of standard Markdown:
- Bold: Wrap text in single asterisks (*text*). Do NOT use double asterisks.
- Italic: Wrap text in single underscores (_text_).
- Strikethrough: Wrap text in single tildes (~text~).
- Inline Code: Wrap text in single backticks.
- Code Block / Monospace: Wrap text in triple backticks.
- Bulleted Lists: Prepend items with a hyphen and a space (- text) or an asterisk and a space (* text).
- Numbered Lists: Prepend items with a number, a period, and a space (1. text).
- Block Quotes: Prepend lines with a greater-than symbol and a space (> text).

CRITICAL FORMATTING GUIDELINES:
- Headings: Do NOT use Markdown headers (#, ##, ###). Use bold text (*HEADER TEXT*) on a new line for section titles.
- Hyperlinks: Do NOT use Markdown link syntax ([text](url)). Write out plain text alongside the raw URL (e.g., Check this out: https://example.com).
- Spacing: Syntax characters must touch the enclosed text directly with no space after the opening character or before the closing character (use *bold*, never * bold *).`;

    const userPromptContent = `### Recent Chat History (Last ${chatHistory.length} messages):
${formattedHistory || '(No previous messages recorded in buffer)'}

--------------------------------------------------
### Current Request:
From: ${senderName}
Prompt / Question: ${promptQuery || '(The user tagged @protone with no extra text. Greet the group politely or ask how you can help.)'}`;

    const currentRpm = aiRateLimiter.getCurrentRpm();
    console.log(`[Groq AI] Dispatching completion request with model "${config.groqModel}" (Current window load: ${currentRpm}/${config.groqRpmLimit} RPM)...`);

    const completion = await groq.chat.completions.create({
      model: config.groqModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPromptContent },
      ],
      temperature: 0.7,
      max_completion_tokens: 1024,
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      return 'Sorry, I could not generate a response. Please try again.';
    }

    return reply;
  } catch (error: any) {
    console.error('[Groq AI] Error generating completion:', error);
    if (error?.status === 429) {
      return '⚠️ [Protone AI] Rate limit reached on Groq API. Please wait a moment before trying again.';
    }
    return `⚠️ Error generating AI response: ${error?.message || 'Unknown error'}`;
  }
}
