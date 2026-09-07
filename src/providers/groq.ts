import { ChatGroq } from '@langchain/groq';
import { config } from '../config.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Creates and returns a Groq Chat Model instance.
 */
export function createGroqModel(): ChatGroq {
  const apiKey = config.groqApiKey || process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is missing in environment or .env file.');
  }

  const modelName = process.env.GROQ_MODEL || config.groqModel || 'openai/gpt-oss-120b';
  console.log(`[Groq Provider] Instantiating Groq Model: "${modelName}"`);

  return new ChatGroq({
    apiKey,
    model: modelName,
    temperature: 0.7,
    maxTokens: 1024,
  });
}
