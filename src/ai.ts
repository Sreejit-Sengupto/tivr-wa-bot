import { ChatGroq } from '@langchain/groq';
import { createAgent } from 'langchain';
import { config } from './config.js';
import { type StoredMessage } from './store.js';
import { aiRateLimiter } from './rateLimiter.js';
import { getAgentTools } from './tools/index.js';

let groqChatModel: ChatGroq | null = null;

function getChatModel(): ChatGroq {
  if (!groqChatModel) {
    const apiKey = config.groqApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set in environment or .env file');
    }
    groqChatModel = new ChatGroq({
      apiKey,
      model: config.groqModel,
      temperature: 0.7,
      maxTokens: 1024,
    });
  }
  return groqChatModel;
}

export interface GenerateResponseParams {
  promptQuery: string;
  senderName: string;
  chatHistory: StoredMessage[];
}

/**
 * Generates an AI response using LangChain and ChatGroq with conversation context
 * and dynamic tool integration (Tavily search, real-time date/time, calculator).
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

    const model = getChatModel();
    const tools = getAgentTools();

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

You also have access to useful tools:
- Real-time date & time utility
- Mathematical calculation tool
- Real-time web search (if enabled)
Use tools when appropriate to provide accurate and up-to-date answers.

Guidelines:
1. Always be direct, friendly, and helpful.
2. WhatsApp formatting is supported: use *bold* for emphasis, _italic_ for subtle tone, and bullet points where useful.
3. Keep answers concise and readable for mobile chat unless a detailed explanation is specifically requested.
4. When asked to summarize or reference past discussions, rely accurately on the provided Chat History.
5. If a tool was used, summarize the result cleanly for group members.`;

    const userPromptContent = `### Recent Chat History (Last ${chatHistory.length} messages):
${formattedHistory || '(No previous messages recorded in buffer)'}

--------------------------------------------------
### Current Request:
From: ${senderName}
Prompt / Question: ${promptQuery || '(The user tagged @protone with no extra text. Greet the group politely or ask how you can help.)'}`;

    const currentRpm = aiRateLimiter.getCurrentRpm();
    console.log(
      `[LangChain AI] Dispatching agent request with ChatGroq model "${config.groqModel}" (${tools.length} active tools, Load: ${currentRpm}/${config.groqRpmLimit} RPM)...`
    );

    const agent = createAgent({
      model,
      tools,
      systemPrompt,
    });

    const result = await agent.invoke({
      messages: [{ role: 'user', content: userPromptContent }],
    });

    const messages = (result as any).messages || [];

    // Log tool execution trail if any tools were called
    for (const msg of messages) {
      if (typeof msg._getType === 'function' && msg._getType() === 'tool') {
        console.log(`[LangChain AI] Tool executed: "${msg.name}" -> result received`);
      }
    }

    const lastMessage = messages[messages.length - 1];
    let reply = '';
    if (lastMessage) {
      if (typeof lastMessage.content === 'string') {
        reply = lastMessage.content.trim();
      } else if (Array.isArray(lastMessage.content)) {
        reply = lastMessage.content
          .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
          .join('\n')
          .trim();
      }
    }

    if (!reply) {
      return 'Sorry, I could not generate a response. Please try again.';
    }

    return reply;
  } catch (error: any) {
    console.error('[LangChain AI] Error generating completion:', error);
    if (
      error?.status === 429 ||
      error?.message?.includes('429') ||
      error?.message?.includes('rate_limit_exceeded')
    ) {
      return '⚠️ [Protone AI] Rate limit reached on Groq API. Please wait a moment before trying again.';
    }
    return `⚠️ Error generating AI response: ${error?.message || 'Unknown error'}`;
  }
}
