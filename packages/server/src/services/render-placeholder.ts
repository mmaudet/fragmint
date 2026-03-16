/**
 * Lightweight placeholder engine for text-based templates (Markdown, HTML).
 *
 * Syntax:
 *   +++INS path+++          — insert value at `path` (supports nested: metadata.client)
 *   +++HTML path+++         — insert value converted from Markdown to HTML
 *   +++FOR var IN array+++  — loop over array items
 *     +++INS $var.field+++  — access item field inside loop
 *   +++END-FOR var+++
 */

let markedInstance: ((md: string) => string) | null = null;

async function getMarked(): Promise<(md: string) => string> {
  if (!markedInstance) {
    const { marked } = await import('marked');
    markedInstance = (md: string) => marked.parse(md, { async: false }) as string;
  }
  return markedInstance;
}

function markdownToHtmlSync(md: string): string {
  // Simple sync conversion for tables and basic markdown
  let html = md;
  // Convert Markdown tables
  const tableRegex = /\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g;
  html = html.replace(tableRegex, (_, header, rows) => {
    const headers = header.split('|').map((h: string) => h.trim()).filter(Boolean);
    const headerHtml = headers.map((h: string) => `<th>${h}</th>`).join('');
    const rowLines = rows.trim().split('\n');
    const rowsHtml = rowLines.map((row: string) => {
      const cells = row.split('|').map((c: string) => c.trim()).filter(Boolean);
      return `<tr>${cells.map((c: string) => `<td>${c}</td>`).join('')}</tr>`;
    }).join('\n');
    return `<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
<thead><tr>${headerHtml}</tr></thead>
<tbody>${rowsHtml}</tbody>
</table>`;
  });
  // Convert **bold**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Convert \n\n to <p>
  html = html.replace(/\n\n/g, '</p><p>');
  // Convert \n to <br>
  html = html.replace(/\n/g, '<br>');
  return html;
}

export function resolvePlaceholders(template: string, data: Record<string, any>): string {
  // 1. Resolve FOR loops first
  let result = resolveForLoops(template, data);
  // 2. Resolve +++HTML path+++ (Markdown → HTML conversion)
  result = result.replace(/\+\+\+HTML\s+(.+?)\+\+\+/g, (_, path) => {
    const value = getNestedValue(data, path.trim());
    if (value === undefined || value === null) return '';
    return markdownToHtmlSync(String(value));
  });
  // 3. Then resolve remaining INS placeholders
  result = result.replace(/\+\+\+INS\s+(.+?)\+\+\+/g, (_, path) => {
    const value = getNestedValue(data, path.trim());
    return value !== undefined && value !== null ? String(value) : '';
  });
  return result;
}

function resolveForLoops(template: string, data: Record<string, any>): string {
  const forRegex = /\+\+\+FOR\s+(\w+)\s+IN\s+(.+?)\+\+\+([\s\S]*?)\+\+\+END-FOR\s+\1\+\+\+/g;
  return template.replace(forRegex, (_, varName, arrayPath, body) => {
    const array = getNestedValue(data, arrayPath.trim());
    if (!Array.isArray(array)) return '';
    return array.map(item => {
      // Handle +++HTML $var.field+++ (Markdown → HTML)
      let resolved = body.replace(
        new RegExp(`\\+\\+\\+HTML\\s+\\$${varName}\\.(.+?)\\+\\+\\+`, 'g'),
        (__, field) => {
          const val = item[field.trim()];
          if (val === undefined || val === null) return '';
          return markdownToHtmlSync(String(val));
        }
      );
      // Handle +++INS $var.field+++
      resolved = resolved.replace(
        new RegExp(`\\+\\+\\+INS\\s+\\$${varName}\\.(.+?)\\+\\+\\+`, 'g'),
        (__, field) => {
          const val = item[field.trim()];
          return val !== undefined && val !== null ? String(val) : '';
        }
      );
      return resolved;
    }).join('');
  });
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
