import { ChatGroq } from '@langchain/groq';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { config } from './config.js';
import { type StoredMessage } from './store.js';
import { aiRateLimiter } from './rateLimiter.js';

let modelInstance: ChatGroq | null = null;

function getChatModel(): ChatGroq {
  if (!modelInstance) {
    const apiKey = config.groqApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set in environment or .env file');
    }
    modelInstance = new ChatGroq({
      apiKey,
      model: config.groqModel,
      temperature: 0.7,
      maxTokens: 1024,
    });
  }
  return modelInstance;
}

/**
 * Formats stored WhatsApp buffer messages into standard LangChain BaseMessage objects.
 */
function formatChatHistoryToLangChainMessages(chatHistory: StoredMessage[]): BaseMessage[] {
  return chatHistory.map((msg) => {
    const time = new Date(msg.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const roleLabel = msg.role === 'assistant' ? 'Protone (Bot)' : msg.senderName;
    const formattedText = `[${time}] ${roleLabel}: ${msg.text}`;

    if (msg.role === 'assistant') {
      return new AIMessage({ content: formattedText });
    }
    return new HumanMessage({ content: formattedText });
  });
}

export interface GenerateResponseParams {
  promptQuery: string;
  senderName: string;
  chatHistory: StoredMessage[];
}

/**
 * Generates an AI response using LangChain ChatGroq with conversation context from recent messages,
 * respecting Groq RPM rate limits via a sliding-window rate limiter.
 */
export async function generateAIResponse({
  promptQuery,
  senderName,
  chatHistory,
}: GenerateResponseParams): Promise<string> {
  if (!config.groqApiKey && !process.env.GROQ_API_KEY) {
    return '⚠️ [tivr AI] GROQ_API_KEY is not configured in your .env file. Please set GROQ_API_KEY to enable AI replies.';
  }

  try {
    // Acquire rate limit slot (delays if RPM limit is reached in the rolling 60s window)
    await aiRateLimiter.acquire();

    const chatModel = getChatModel();
    const langchainMessages = formatChatHistoryToLangChainMessages(chatHistory);

    const currentRpm = aiRateLimiter.getCurrentRpm();
    console.log(
      `[LangChain AI] Dispatching chain request with model "${config.groqModel}" (Current window load: ${currentRpm}/${config.groqRpmLimit} RPM)...`
    );

    const promptTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are tivr, a smart, helpful, and concise AI assistant inside a WhatsApp group chat.
        You have access to the recent conversation history of the group (up to the past 20 messages).
        Use this context to understand references, questions, summaries, or specific tasks requested by the group members.

        Guidelines:
        1. Always be direct, friendly, and helpful.
        2. WhatsApp formatting is supported: use *bold* for emphasis, _italic_ for subtle tone, and bullet points where useful.
        3. Keep answers concise and readable for mobile chat unless a detailed explanation is specifically requested.
        4. When asked to summarize or reference past discussions, rely accurately on the provided Chat History.`,
      ],
      new MessagesPlaceholder('chat_history'),
      ['human', 'From: {senderName}\nPrompt / Question: {promptQuery}'],
    ]);

    const outputParser = new StringOutputParser();
    const chain = promptTemplate.pipe(chatModel).pipe(outputParser);

    const effectiveQuery =
      promptQuery ||
      '(The user tagged @tivr with no extra text. Greet the group politely or ask how you can help.)';

    const reply = await chain.invoke({
      chat_history: langchainMessages,
      senderName,
      promptQuery: effectiveQuery,
    });

    const trimmedReply = reply?.trim();
    if (!trimmedReply) {
      return 'Sorry, I could not generate a response. Please try again.';
    }

    return trimmedReply;
  } catch (error: any) {
    console.error('[LangChain AI] Error generating response:', error);
    if (error?.status === 429 || error?.message?.includes('429')) {
      return '⚠️ [tivr AI] Rate limit reached on Groq API. Please wait a moment before trying again.';
    }
    return `⚠️ Error generating AI response: ${error?.message || 'Unknown error'}`;
  }
}
