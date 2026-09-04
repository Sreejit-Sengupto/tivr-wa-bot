import { tool } from '@langchain/core/tools';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Tavily Search — Token & Rate-limit optimizations
// ---------------------------------------------------------------------------

/**
 * Simple in-memory TTL cache for Tavily search results.
 * Prevents duplicate API calls for identical queries within a short time window,
 * reducing both Tavily monthly quota usage and LLM token costs.
 */
const tavilyCache = new Map<string, { result: string; expiresAt: number }>();
const TAVILY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Minimal sliding-window rate limiter for Tavily (free tier ≈ 1 req/s).
 * Inserts a small delay between consecutive Tavily calls to avoid HTTP 429s.
 */
let lastTavilyCallAt = 0;
const TAVILY_MIN_INTERVAL_MS = 1_200; // safely under 1 req/s

async function throttleTavily(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastTavilyCallAt;
  if (elapsed < TAVILY_MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, TAVILY_MIN_INTERVAL_MS - elapsed));
  }
  lastTavilyCallAt = Date.now();
}

/**
 * Trims a string to a maximum character length, appending an ellipsis if truncated.
 * Used to cap per-result content and prevent context-window flooding.
 */
function trimContent(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\u2026';
}

/**
 * Tool: Current Date & Time
 * Allows the LLM to know the accurate current date, time, and timezone.
 */
export const getCurrentDateTime = tool(
  async () => {
    const now = new Date();
    return JSON.stringify({
      iso: now.toISOString(),
      formatted: now.toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
      }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  },
  {
    name: 'get_current_date_time',
    description: 'Returns the current real-world date, time, and timezone. Use whenever a user asks about today, the current date, time, or relative days (e.g. yesterday, tomorrow).',
    schema: z.object({}),
  }
);

/**
 * Tool: Safe Math Calculator
 * Safely evaluates basic mathematical expressions (+, -, *, /, %, ^, parentheses).
 */
export const calculator = tool(
  async ({ expression }) => {
    try {
      // Sanitize expression: allow only numbers, basic operators, whitespace, and parentheses
      const sanitized = expression.replace(/[^0-9+\-*/().^%eE ]/g, '');
      if (!sanitized.trim()) {
        return 'Error: Invalid math expression.';
      }

      // Safe evaluation using Function constructor in strict mode with restricted input
      // Convert ^ to ** for exponentiation
      const formattedExpr = sanitized.replace(/\^/g, '**');
      const calculate = new Function(`'use strict'; return (${formattedExpr});`);
      const result = calculate();

      if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
        return `Result: Undefined or Non-numeric (${result})`;
      }

      return `Result of ${expression} = ${result}`;
    } catch (err: any) {
      return `Error calculating "${expression}": ${err?.message || 'Invalid syntax'}`;
    }
  },
  {
    name: 'calculator',
    description: 'Perform arithmetic and mathematical calculations. Use this tool for any complex calculations, percentages, unit multiplications, or precision math.',
    schema: z.object({
      expression: z.string().describe('The mathematical expression to evaluate (e.g., "4829 * 382", "(1500 * 0.18) + 1500")'),
    }),
  }
);

/**
 * Builds a token-efficient Tavily search tool with:
 *  - maxResults: 2  (down from 5 — reduces raw content volume by ~60%)
 *  - Prefers Tavily's pre-summarised "answer" field (compact, accurate)
 *  - Per-result content trimmed to 800 chars as a safety net
 *  - TTL result cache (5 min) to skip redundant API calls
 *  - 1.2 s inter-call throttle to stay within Tavily free-tier limits
 *  - Graceful HTTP 429 handling (returns a user-friendly message, no crash)
 */
function buildTavilyTool(tavilyApiKey: string): any {
  const rawSearch = new TavilySearch({
    tavilyApiKey,
    maxResults: 1,
  });

  return tool(
    async ({ query }: { query: string }) => {
      // 1. Cache lookup
      const cacheKey = query.trim().toLowerCase();
      const cached = tavilyCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        console.log(`[Tavily] Cache hit for query: "${query}"`);
        return cached.result;
      }

      // 2. Rate-limit throttle
      await throttleTavily();

      // 3. Perform search
      console.log(`[Tavily] Web search: "${query}"`);
      let rawResult: string;
      try {
        rawResult = await rawSearch.invoke({ query });
      } catch (err: any) {
        if (err?.status === 429 || err?.message?.includes('429')) {
          return '\u26a0\ufe0f Web search temporarily unavailable (rate limited). Please try again in a moment.';
        }
        throw err;
      }

      // 4. Parse & build compact representation
      let parsed: any;
      try {
        parsed = JSON.parse(rawResult);
      } catch {
        // Not JSON — trim and return as-is
        const trimmed = trimContent(rawResult, 1_500);
        tavilyCache.set(cacheKey, { result: trimmed, expiresAt: Date.now() + TAVILY_CACHE_TTL_MS });
        return trimmed;
      }

      const parts: string[] = [];

      // Prefer the concise AI-generated answer Tavily provides
      if (parsed?.answer) {
        parts.push(`**Answer:** ${trimContent(String(parsed.answer), 600)}`);
      }

      // Append trimmed per-result snippets (title + content + URL)
      const results: any[] = Array.isArray(parsed?.results) ? parsed.results : [];
      results.forEach((r: any, i: number) => {
        const title = r?.title ? `[${r.title}]` : `[Result ${i + 1}]`;
        const snippet = trimContent(r?.content || r?.snippet || '', 400);
        const url = r?.url ? ` (${r.url})` : '';
        if (snippet) parts.push(`${title}${url}: ${snippet}`);
      });

      const finalResult = parts.length ? parts.join('\n\n') : 'No relevant results found.';

      // 5. Store in cache + lightweight GC
      tavilyCache.set(cacheKey, { result: finalResult, expiresAt: Date.now() + TAVILY_CACHE_TTL_MS });
      const now = Date.now();
      for (const [k, v] of tavilyCache) {
        if (now >= v.expiresAt) tavilyCache.delete(k);
      }

      return finalResult;
    },
    {
      name: 'web_search',
      description:
        'Search the internet for real-time information, recent news, sports scores, stock prices, weather, or any topic that requires up-to-date knowledge. Use only when the answer cannot be derived from context or chat history. Use the get_current_date_time tool before calling this tool.',
      schema: z.object({
        query: z.string().describe('A concise, specific search query (e.g., "India vs Australia cricket score today")'),
      }),
    }
  );
}

/**
 * Builds and returns the list of active tools for the agent.
 */
export function getAgentTools(): any[] {
  const tools: any[] = [getCurrentDateTime, calculator];

  const tavilyApiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
  if (tavilyApiKey) {
    try {
      const searchTool = buildTavilyTool(tavilyApiKey);
      tools.push(searchTool);
      console.log('[Tools] Tavily Web Search tool initialized (optimized: 2 results, cached, throttled).');
    } catch (err) {
      console.warn('[Tools] Failed to initialize Tavily search tool:', err);
    }
  } else {
    console.log('[Tools] TAVILY_API_KEY not configured. Web search tool is disabled (Add TAVILY_API_KEY in .env to enable).');
  }

  return tools;
}
