import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { AIMessage, HumanMessage, ToolMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { config } from './config.js';
import { type StoredMessage } from './store.js';
import { aiRateLimiter } from './rateLimiter.js';
import { getBotTools } from './tools/index.js';
import { formatForWhatsApp } from './formatter.js';
import { createGeminiModel } from './providers/gemini.js';
// Note: Groq provider is available in ./providers/groq.js if needed in the future

function getChatModel(): BaseChatModel {
  // Directly calling the Gemini provider as requested
  return createGeminiModel();
}

/**
 * Formats stored WhatsApp messages into standard LangChain BaseMessage objects.
 */
function formatChatHistory(chatHistory: StoredMessage[]): BaseMessage[] {
  return chatHistory.map((msg) => {
    if (msg.role === 'assistant') {
      return new AIMessage({ content: msg.text });
    }
    return new HumanMessage({ content: `${msg.senderName}: ${msg.text}` });
  });
}

/**
 * Synthesizes a clean text response when tool execution completes or produces empty text.
 */
async function synthesizeFinalResponse(messages: BaseMessage[], chatModel: BaseChatModel): Promise<AIMessage> {
  const currentDateStr = new Date().toISOString().split('T')[0];
  const sanitized: BaseMessage[] = [
    new SystemMessage(
      `You are tivr, a smart and helpful AI assistant inside a WhatsApp group chat.\nCurrent real-world date: ${currentDateStr}.\nIMPORTANT DIRECTIVE: Respond in plain text only. Do NOT output any JSON, function call, or tool call under any circumstances.`
    ),
  ];
  const toolOutputs: string[] = [];

  for (const msg of messages) {
    if (msg instanceof ToolMessage) {
      if (typeof msg.content === 'string' && msg.content.trim()) {
        toolOutputs.push(msg.content.trim());
      }
    } else if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
      continue;
    } else if (msg instanceof SystemMessage) {
      continue;
    } else {
      sanitized.push(msg);
    }
  }

  const contextInfo =
    toolOutputs.length > 0
      ? `Retrieved Information:\n${toolOutputs.join('\n\n')}\n\nBased on the above information (and your general knowledge), provide a direct, concise answer to the user prompt.`
      : 'Please provide a direct and concise answer to the user question.';

  sanitized.push(new HumanMessage(contextInfo));
  const res = await chatModel.invoke(sanitized);
  return res as AIMessage;
}

export interface GenerateResponseParams {
  promptQuery: string;
  senderName: string;
  chatHistory: StoredMessage[];
}

/**
 * Generates an AI response using LangChain with Gemini and tools.
 */
export async function generateAIResponse({
  promptQuery,
  senderName,
  chatHistory,
}: GenerateResponseParams): Promise<string> {
  if (!config.geminiApiKey && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    return '⚠️ GEMINI_API_KEY (or GOOGLE_API_KEY) is missing. Please set it in your .env file.';
  }

  try {
    await aiRateLimiter.acquire();

    const chatModel = getChatModel();
    const allTools = getBotTools();
    const modelWithTools = allTools.length > 0 && (chatModel as any).bindTools ? (chatModel as any).bindTools(allTools) : chatModel;
    const historyMessages = formatChatHistory(chatHistory);

    const activeModelName = config.geminiModel || 'gemini-3.5-flash-lite';
    console.log(
      `[LangChain AI] Dispatching request with GEMINI ("${activeModelName}") [Active Tools: ${allTools.length}]...`
    );

    const currentDateStr = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();

    const promptTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are hgbot, a smart, helpful, and concise AI assistant inside a WhatsApp group chat.
Current real-world date: ${currentDateStr} (Year: ${currentYear}).
When the user asks about recent events, latest scores, recent matches/ducks, or current news, assume the present time is ${currentYear}. Formulate search queries naturally for up-to-date information.
You have access to recent group messages for context.

Tools:
- get_weather: Fetch live weather data for a city or location.
- search_internet: Search the web for cricket scores, sports updates, news, or general facts.
Call available tools automatically whenever live or external real-time data is needed.

Formatting & Style:
- You are responding inside WhatsApp. ONLY use WhatsApp-compatible formatting.
- WhatsApp supports: *bold* (single asterisk), _italic_ (underscore), ~strikethrough~ (tilde), \`\`\`code blocks\`\`\`.
- NEVER use markdown tables (| col | col |), markdown headers (# or ##), or markdown links ([text](url)).
- Use bullet points (• or -) and numbered lists for structured data instead of tables.
- Keep responses concise and mobile-friendly.`,
      ],
      new MessagesPlaceholder('chat_history'),
      ['human', 'From: {senderName}\nQuestion: {promptQuery}'],
    ]);

    const effectiveQuery =
      promptQuery ||
      '(The user tagged @hgbot with no extra text. Greet the group politely.)';

    const formattedMessages = await promptTemplate.formatMessages({
      chat_history: historyMessages,
      senderName,
      promptQuery: effectiveQuery,
    });

    const messages: BaseMessage[] = [...formattedMessages];
    let response = await modelWithTools.invoke(messages);

    const maxIterations = 3;
    let iteration = 0;

    while (response.tool_calls && response.tool_calls.length > 0 && iteration < maxIterations) {
      iteration++;
      messages.push(response);

      for (const toolCall of response.tool_calls) {
        console.log(`[LangChain AI] Executing tool "${toolCall.name}" with args:`, toolCall.args);
        const targetTool = allTools.find((t) => t.name === toolCall.name);

        let toolOutput = '';
        if (targetTool) {
          try {
            const result = await (targetTool as any).invoke(toolCall.args || {});
            toolOutput = typeof result === 'string' ? result : JSON.stringify(result);
          } catch (err: any) {
            console.error(`[LangChain AI] Tool execution error for "${toolCall.name}":`, err);
            toolOutput = `Error executing tool ${toolCall.name}: ${err?.message || 'Unknown error'}`;
          }
        } else {
          toolOutput = `Tool ${toolCall.name} not found`;
        }

        messages.push(
          new ToolMessage({
            content: toolOutput,
            tool_call_id: toolCall.id || toolCall.name,
          })
        );
      }

      response = await modelWithTools.invoke(messages);
    }

    let reply = typeof response.content === 'string' ? response.content.trim() : '';

    if (!reply || (response.tool_calls && response.tool_calls.length > 0)) {
      console.log('[LangChain AI] Synthesizing final text response...');
      const finalRes = await synthesizeFinalResponse(messages, chatModel);
      reply = typeof finalRes.content === 'string' ? finalRes.content.trim() : '';
    }

    return formatForWhatsApp(reply) || 'Sorry, I could not generate a response. Please try again.';
  } catch (error: any) {
    console.error('[LangChain AI] Error generating response:', error);
    if (error?.status === 429 || error?.message?.includes('429')) {
      return '⚠️ Rate limit reached. Please wait a moment before trying again.';
    }
    return `⚠️ Error generating AI response: ${error?.message || 'Unknown error'}`;
  }
}
