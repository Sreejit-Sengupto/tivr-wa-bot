import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { config } from '../config.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Creates and returns a Google Gemini Chat Model instance.
 */
export function createGeminiModel(): ChatGoogleGenerativeAI {
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY / GOOGLE_API_KEY is missing in environment or .env file.');
  }

  const modelName = process.env.GEMINI_MODEL || config.geminiModel || 'gemini-3.5-flash-lite';
  console.log(`[Gemini Provider] Instantiating Google Gemini Model: "${modelName}"`);

  return new ChatGoogleGenerativeAI({
    apiKey,
    model: modelName,
    temperature: 0.7,
    maxOutputTokens: 1024,
  });
}
