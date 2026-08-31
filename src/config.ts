import dotenv from 'dotenv';

dotenv.config();

export const config = {
  authDir: process.env.AUTH_DIR || './auth_info',
  logLevel: process.env.LOG_LEVEL || 'info',
  targetGroupJid: process.env.TARGET_GROUP_JID || '',
  triggerTag: process.env.TRIGGER_TAG || '@protone',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  groqRpmLimit: Number(process.env.GROQ_RPM_LIMIT) || 25,
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
};

