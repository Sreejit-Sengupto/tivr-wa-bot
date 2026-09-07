/**
 * Converts markdown-formatted AI output into WhatsApp-compatible plain text.
 *
 * WhatsApp supports:
 *   *bold*           (single asterisks)
 *   _italic_         (underscores)
 *   ~strikethrough~  (tildes)
 *   ```monospace```  (triple backticks, block only)
 *
 * WhatsApp does NOT support:
 *   # headers, tables, [links](url), ![images](url), --- rules, ** double-asterisk bold
 */
export function formatForWhatsApp(text: string): string {
  if (!text) return text;

  let result = text;

  // ── 1. Preserve code blocks (``` ... ```) so they are not mangled ──
  const codeBlocks: string[] = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // ── 2. Preserve inline code (` ... `) ──
  const inlineCode: string[] = [];
  result = result.replace(/`([^`]+)`/g, (match) => {
    inlineCode.push(match);
    return `__INLINE_CODE_${inlineCode.length - 1}__`;
  });

  // ── 3. Convert markdown tables to readable plain text ──
  // Detect table blocks (lines starting with |) and convert them
  result = result.replace(
    /((?:^[ \t]*\|.+\|[ \t]*$\n?){2,})/gm,
    (tableBlock) => {
      const rows = tableBlock
        .trim()
        .split('\n')
        .map((row) => row.trim())
        .filter((row) => row.length > 0);

      const parsed: string[][] = [];
      for (const row of rows) {
        // Skip separator rows like |---|---|
        if (/^\|[\s\-:|]+\|$/.test(row)) continue;
        const cells = row
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
        parsed.push(cells);
      }

      if (parsed.length === 0) return tableBlock;

      const headers = parsed[0];
      const dataRows = parsed.slice(1);

      if (dataRows.length === 0) {
        // Single-row table, just list values
        return headers.join(' • ') + '\n';
      }

      // Format as labeled rows
      const lines: string[] = [];
      for (const dataRow of dataRows) {
        const parts = dataRow
          .map((cell, i) => {
            const label = headers[i] || '';
            return label ? `*${label}:* ${cell}` : cell;
          })
          .join('  |  ');
        lines.push(parts);
      }
      return lines.join('\n') + '\n';
    }
  );

  // ── 4. Convert headers (# ## ### etc.) to *bold* lines ──
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // ── 5. Convert **bold** (double asterisks) to *bold* (single) ──
  // WhatsApp uses single asterisks for bold
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // ── 6. Convert markdown links [text](url) to "text (url)" ──
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // ── 7. Convert image syntax ![alt](url) to just the url ──
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$2');

  // ── 8. Remove horizontal rules (--- / *** / ___) ──
  result = result.replace(/^[\s]*([-*_]){3,}[\s]*$/gm, '');

  // ── 9. Clean up excessive blank lines (max 2 consecutive) ──
  result = result.replace(/\n{3,}/g, '\n\n');

  // ── 10. Restore code blocks and inline code ──
  for (let i = 0; i < codeBlocks.length; i++) {
    result = result.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }
  for (let i = 0; i < inlineCode.length; i++) {
    result = result.replace(`__INLINE_CODE_${i}__`, inlineCode[i]);
  }

  return result.trim();
}
