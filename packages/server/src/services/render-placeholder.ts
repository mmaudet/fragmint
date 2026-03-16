/**
 * Lightweight placeholder engine for text-based templates (Markdown, HTML).
 *
 * Syntax:
 *   +++INS path+++          — insert value at `path` (supports nested: metadata.client)
 *   +++FOR var IN array+++  — loop over array items
 *     +++INS $var.field+++  — access item field inside loop
 *   +++END-FOR var+++
 */

export function resolvePlaceholders(template: string, data: Record<string, any>): string {
  // 1. Resolve FOR loops first
  let result = resolveForLoops(template, data);
  // 2. Then resolve remaining INS placeholders
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
      return body.replace(
        new RegExp(`\\+\\+\\+INS\\s+\\$${varName}\\.(.+?)\\+\\+\\+`, 'g'),
        (__, field) => {
          const val = item[field.trim()];
          return val !== undefined && val !== null ? String(val) : '';
        }
      );
    }).join('');
  });
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
