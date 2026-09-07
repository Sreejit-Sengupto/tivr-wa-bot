import { weatherTool } from './weather.js';
import { webSearchTool } from './search.js';
import { initSwiggyTools } from './swiggy.js';
import { config } from '../config.js';
import type { StructuredToolInterface } from '@langchain/core/tools';

export { weatherTool, webSearchTool };

/** Combined tool list populated at startup based on config toggles */
let _allTools: StructuredToolInterface[] = [];

/**
 * Initializes tools based on individual config toggles (weather, search, swiggy).
 * Deduplicates by tool name to prevent API schema errors in Gemini/Groq.
 */
export async function initAllTools(): Promise<void> {
  const activeTools: StructuredToolInterface[] = [];

  if (config.enableWeatherTool) {
    console.log('[Tools] Weather tool enabled');
    activeTools.push(weatherTool);
  } else {
    console.log('[Tools] Weather tool disabled');
  }

  if (config.enableSearchTool) {
    console.log('[Tools] Web search tool enabled');
    activeTools.push(webSearchTool);
  } else {
    console.log('[Tools] Web search tool disabled');
  }

  if (config.enableSwiggyTools) {
    console.log('[Tools] Swiggy MCP tools enabled');
    const swiggyTools = await initSwiggyTools();
    activeTools.push(...swiggyTools);
  } else {
    console.log('[Tools] Swiggy MCP tools disabled');
  }

  const toolMap = new Map<string, StructuredToolInterface>();
  for (const t of activeTools) {
    if (!toolMap.has(t.name)) {
      toolMap.set(t.name, t);
    }
  }

  _allTools = Array.from(toolMap.values());
  console.log(`[Tools] Initialized ${_allTools.length} total active tools`);
}

/**
 * Returns the full list of active initialized tools.
 */
export function getBotTools(): StructuredToolInterface[] {
  return _allTools;
}

/**
 * Clean exported array of all base tools.
 * @deprecated Use getBotTools() after calling initAllTools() instead.
 */
export const botTools = [weatherTool, webSearchTool];
