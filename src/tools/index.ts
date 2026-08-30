import { weatherTool } from './weather.js';
import { webSearchTool } from './search.js';

export { weatherTool, webSearchTool };

/**
 * Clean exported array of all tools available to the AI agent.
 */
export const botTools = [weatherTool, webSearchTool];
