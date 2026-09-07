import dotenv from "dotenv";

dotenv.config();

export const config = {
  authDir: process.env.AUTH_DIR || "./auth_info",
  logLevel: process.env.LOG_LEVEL || "info",
  targetGroupJid: process.env.TARGET_GROUP_JID || "",
  triggerTag: process.env.TRIGGER_TAG || "@hgbot",

  // Granular Individual Tool Toggles (true by default unless set to 'false')
  enableWeatherTool: process.env.ENABLE_WEATHER_TOOL !== "false",
  enableSearchTool: process.env.ENABLE_SEARCH_TOOL !== "false",
  enableSwiggyTools: process.env.ENABLE_SWIGGY_TOOLS !== "false",

  // AI Provider Toggle: 'gemini' | 'groq'
  aiProvider: (process.env.AI_PROVIDER || "gemini").toLowerCase() as
    | "gemini"
    | "groq",

  // Gemini API Configuration
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",

  // Groq API Configuration (Togglable)
  groqApiKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  groqRpmLimit: Number(process.env.GROQ_RPM_LIMIT) || 25,

  // Swiggy MCP Configuration
  swiggyAccessToken: process.env.SWIGGY_ACCESS_TOKEN || "",
  swiggyServers: (process.env.SWIGGY_SERVERS || "food,im,dineout")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // History Sync & Startup Freshness Configuration
  startFresh: process.env.START_FRESH !== "false", // Default: true (skips processing messages sent prior to bot startup)
  maxMessageAgeSeconds: Number(process.env.MAX_MESSAGE_AGE_SECONDS) || 120, // Default: 120s (ignore messages older than 2 mins)
  syncHistory: process.env.SYNC_HISTORY === "true", // Default: false (disables downloading historical notification archives on connect)
};
