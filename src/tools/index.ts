import { tool } from '@langchain/core/tools';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';
import { config } from '../config.js';

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
 * Builds and returns the list of active tools for the agent.
 */
export function getAgentTools(): any[] {
  const tools: any[] = [getCurrentDateTime, calculator];

  const tavilyApiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY;
  if (tavilyApiKey) {
    try {
      const searchTool = new TavilySearch({
        tavilyApiKey,
        maxResults: 5,
      });
      tools.push(searchTool);
      console.log('[Tools] Tavily Web Search tool initialized and enabled.');
    } catch (err) {
      console.warn('[Tools] Failed to initialize Tavily search tool:', err);
    }
  } else {
    console.log('[Tools] TAVILY_API_KEY not configured. Web search tool is disabled (Add TAVILY_API_KEY in .env to enable).');
  }

  return tools;
}
