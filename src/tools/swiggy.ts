import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { config } from '../config.js';

/**
 * PRIVACY ALLOW-LIST: Only these tools are exposed to the WhatsApp group chat.
 * Everything else (orders, addresses, cart, payments, bookings, tracking) is blocked
 * so the bot cannot access or reveal personal data.
 */
const ALLOWED_TOOLS = new Set([
  // ── Address / Location (Needed to locate nearby restaurants/groceries) ──
  'get_addresses',

  // ── Food: browse & discover ──
  'search_restaurants',
  'get_restaurant_menu',
  'search_menu',
  'fetch_food_coupons',

  // ── Instamart: browse & discover ──
  'search_products',

  // ── Dineout: browse & discover ──
  'search_restaurants_dineout',
  'get_restaurant_details',
  'get_available_slots',
]);

/** Swiggy MCP server definitions */
const SWIGGY_SERVERS: Record<string, string> = {
  food: 'https://mcp.swiggy.com/food',
  im: 'https://mcp.swiggy.com/im',
  dineout: 'https://mcp.swiggy.com/dineout',
};

/** Active MCP client connections (for cleanup) */
const activeClients: Client[] = [];

/**
 * Converts a JSON Schema property to a basic Zod type.
 */
function jsonSchemaPropertyToZod(prop: Record<string, any>, required: boolean): z.ZodTypeAny {
  let field: z.ZodTypeAny;

  switch (prop.type) {
    case 'string':
      field = z.string();
      break;
    case 'number':
    case 'integer':
      field = z.number();
      break;
    case 'boolean':
      field = z.boolean();
      break;
    case 'array':
      field = z.array(z.any());
      break;
    default:
      field = z.any();
      break;
  }

  if (prop.description) {
    field = field.describe(prop.description);
  }

  if (!required) {
    field = field.optional();
  }

  return field;
}

/**
 * Converts a JSON Schema `inputSchema` from MCP into a Zod object schema.
 */
function jsonSchemaToZod(schema: Record<string, any> | undefined): z.ZodObject<any> {
  if (!schema || !schema.properties) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  const requiredFields = new Set<string>(schema.required || []);

  for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
    shape[key] = jsonSchemaPropertyToZod(prop, requiredFields.has(key));
  }

  return z.object(shape);
}

/**
 * Connects to a single Swiggy MCP server and returns LangChain-compatible tools
 * filtered through the privacy allow-list.
 */
async function connectToServer(serverName: string, serverUrl: string, token: string) {
  const transport = new StreamableHTTPClientTransport(
    new URL(serverUrl),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  );

  const client = new Client({
    name: 'tivr-whatsapp-bot',
    version: '1.0.0',
  });

  await client.connect(transport);
  activeClients.push(client);

  console.log(`[Swiggy MCP] Connected to ${serverName} server at ${serverUrl}`);

  // Discover available tools from this server
  const { tools: mcpTools } = await client.listTools();
  console.log(`[Swiggy MCP] ${serverName}: discovered ${mcpTools.length} tools total`);

  // Filter to only allowed (privacy-safe) tools
  const safeMcpTools = mcpTools.filter((t) => ALLOWED_TOOLS.has(t.name));
  console.log(`[Swiggy MCP] ${serverName}: ${safeMcpTools.length} tools pass privacy filter`);

  if (safeMcpTools.length > 0) {
    console.log(`[Swiggy MCP] ${serverName} exposed tools: ${safeMcpTools.map((t) => t.name).join(', ')}`);
  }

  // Convert each MCP tool to a LangChain tool
  const langchainTools = safeMcpTools.map((mcpTool) => {
    const zodSchema = jsonSchemaToZod(mcpTool.inputSchema as Record<string, any> | undefined);

    return tool(
      async (args: Record<string, any>) => {
        try {
          console.log(`[Swiggy MCP] Calling ${serverName}/${mcpTool.name} with args:`, args);
          const result = await client.callTool({
            name: mcpTool.name,
            arguments: args,
          });

          // MCP returns { content: [{ type, text }] } or similar
          if (result.content && Array.isArray(result.content)) {
            const textParts = result.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text);
            if (textParts.length > 0) {
              return textParts.join('\n');
            }
          }

          return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (err: any) {
          console.error(`[Swiggy MCP] Error calling ${mcpTool.name}:`, err?.message || err);
          return `Error calling Swiggy ${mcpTool.name}: ${err?.message || 'Unknown error'}`;
        }
      },
      {
        name: mcpTool.name,
        description: `[Swiggy ${serverName}] ${mcpTool.description || mcpTool.name}`,
        schema: zodSchema,
      },
    );
  });

  return langchainTools as unknown as StructuredToolInterface[];
}

/**
 * Initializes connections to all configured Swiggy MCP servers and returns
 * the combined, deduplicated set of privacy-filtered LangChain tools.
 *
 * Returns an empty array if SWIGGY_ACCESS_TOKEN is not set.
 */
export async function initSwiggyTools(): Promise<StructuredToolInterface[]> {
  const token = config.swiggyAccessToken;

  if (!token) {
    console.log('[Swiggy MCP] No SWIGGY_ACCESS_TOKEN set — skipping Swiggy integration.');
    console.log('[Swiggy MCP] To enable, run the OAuth flow and add the token to .env');
    return [];
  }

  const toolMap = new Map<string, StructuredToolInterface>();

  for (const serverName of config.swiggyServers) {
    const serverUrl = SWIGGY_SERVERS[serverName];
    if (!serverUrl) {
      console.warn(`[Swiggy MCP] Unknown server name: "${serverName}" — skipping.`);
      continue;
    }

    try {
      const tools = await connectToServer(serverName, serverUrl, token);
      for (const t of tools) {
        if (!toolMap.has(t.name)) {
          toolMap.set(t.name, t);
        }
      }
    } catch (err: any) {
      console.error(`[Swiggy MCP] Failed to connect to ${serverName}:`, err?.message || err);
      if (err?.message?.includes('401') || err?.message?.includes('Unauthorized')) {
        console.error('[Swiggy MCP] Token may be expired. Re-run the OAuth flow and update .env');
      }
    }
  }

  const uniqueTools = Array.from(toolMap.values());
  console.log(`[Swiggy MCP] Total unique Swiggy tools available: ${uniqueTools.length}`);
  return uniqueTools;
}

/**
 * Cleanly disconnects all active MCP client sessions.
 */
export async function closeSwiggyClients(): Promise<void> {
  for (const client of activeClients) {
    try {
      await client.close();
    } catch (_) {
      // Ignore close errors
    }
  }
  activeClients.length = 0;
  console.log('[Swiggy MCP] All client connections closed.');
}
