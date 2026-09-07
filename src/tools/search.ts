import { tool } from '@langchain/core/tools';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';

interface SearchSnippet {
  source: string;
  title: string;
  snippet: string;
  url?: string;
}

/**
 * Performs web search using Tavily API.
 */
async function performMultiSourceSearch(query: string): Promise<string> {
  const snippets: SearchSnippet[] = [];
  const tavilyApiKey = process.env.TAVILY_API_KEY;

  const tasks: Promise<void>[] = [];

  // 1. Tavily Web Search
  if (tavilyApiKey) {
    tasks.push(
      (async () => {
        try {
          console.log(`\n=================== [TAVILY SEARCH] ===================`);
          console.log(`[Tavily Search] Invoking API for query: "${query}"...`);
          const tavily = new TavilySearch({
            tavilyApiKey,
            maxResults: 3,
          });
          const rawResult = await tavily.invoke({ query });
          let parsed: any = rawResult;
          if (typeof rawResult === 'string') {
            try {
              parsed = JSON.parse(rawResult);
            } catch (_) {}
          }
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.results)) {
            let tavilyCount = 0;
            for (const r of parsed.results.slice(0, 2)) {
              if (r.content || r.title) {
                snippets.push({
                  source: 'Tavily Web',
                  title: r.title || 'Web Source',
                  snippet: (r.content || '').slice(0, 150).replace(/\s+/g, ' ').trim(),
                  url: r.url,
                });
                tavilyCount++;
              }
            }
            console.log(`[Tavily Search] Successfully fetched ${tavilyCount} snippet(s)`);
          } else {
            console.log(`[Tavily Search] Response received but no result items found.`);
          }
          console.log(`===========================================================\n`);
        } catch (err: any) {
          console.warn(`[Tavily Search] Error: ${err?.message}`);
        }
      })()
    );
  }

  /*
  // 2. Wikipedia Search API + REST Page Summary (COMMENTED OUT)
  tasks.push(
    (async () => {
      try {
        console.log(`\n================== [WIKIPEDIA SEARCH] ==================`);
        console.log(`[Wikipedia Search] Querying Wikipedia API for: "${query}"...`);
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&origin=*`;
        const wikiRes = await fetch(wikiUrl);
        if (wikiRes.ok) {
          const wikiData = (await wikiRes.json()) as {
            query?: {
              search?: Array<{ title: string; snippet: string }>;
            };
          };
          const items = wikiData.query?.search || [];
          let wikiCount = 0;
          for (const item of items.slice(0, 2)) {
            try {
              const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(item.title)}`;
              const sumRes = await fetch(sumUrl);
              if (sumRes.ok) {
                const sumData = (await sumRes.json()) as { title?: string; extract?: string };
                if (sumData.extract) {
                  snippets.push({
                    source: 'Wikipedia',
                    title: sumData.title || item.title,
                    snippet: sumData.extract.slice(0, 150).replace(/\s+/g, ' ').trim(),
                  });
                  wikiCount++;
                  continue;
                }
              }
            } catch (_) {}
            const cleanSnippet = item.snippet.replace(/<[^>]+>/g, '').trim();
            if (cleanSnippet) {
              snippets.push({
                source: 'Wikipedia',
                title: item.title,
                snippet: cleanSnippet.slice(0, 150).replace(/\s+/g, ' ').trim(),
              });
              wikiCount++;
            }
          }
          console.log(`[Wikipedia Search] Successfully fetched ${wikiCount} snippet(s)`);
        } else {
          console.log(`[Wikipedia Search] API request failed with status: ${wikiRes.status}`);
        }
        console.log(`===========================================================\n`);
      } catch (err: any) {
        console.warn(`[Wikipedia Search] Error: ${err?.message}`);
      }
    })()
  );
  */

  await Promise.allSettled(tasks);

  console.log(`\n================ [CONSOLIDATED SEARCH RESULTS] ================`);
  console.log(`Total Snippets Gathered: ${snippets.length}`);
  console.log(`Result Array:`, snippets);
  console.log(`===================================================================\n`);

  if (snippets.length > 0) {
    return (
      `Web Search Results for "${query}":\n\n` +
      snippets.map((s, i) => `${i + 1}. [${s.source}: ${s.title}] ${s.snippet}`).join('\n\n')
    );
  }

  return `No search results found for "${query}".`;
}

/**
 * Web search tool for live cricket scores, sports updates, news, and general internet browsing.
 * Uses Tavily API for fast and accurate live information.
 */
export const webSearchTool = tool(
  async (args: Record<string, any>) => {
    const query =
      (args?.query || args?.search || args?.q || args?.topic || Object.values(args || {}).filter((v) => typeof v === 'string').join(' ')).trim();

    if (!query) {
      console.log('[Search Tool] Empty search query provided.');
      return 'No search query provided. Please specify what to search for.';
    }

    return await performMultiSourceSearch(query);
  },
  {
    name: 'search_internet',
    description:
      'Search the internet for up-to-date live information, cricket match scores, sports results, breaking news, or general web facts.',
    schema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          'The search query (e.g. "IPL winner", "current sports updates", "latest news").'
        ),
      top_n: z.any().optional(),
      recency_days: z.any().optional(),
      limit: z.any().optional(),
      max_results: z.any().optional(),
      num_results: z.any().optional(),
      date: z.any().optional(),
      filter: z.any().optional(),
      topic: z.any().optional(),
      cursor: z.any().optional(),
      id: z.any().optional(),
      q: z.any().optional(),
      search: z.any().optional(),
    }),
  }
);
