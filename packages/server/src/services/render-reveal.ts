import { readFileSync } from 'node:fs';
import { resolvePlaceholders } from './render-placeholder.js';
import type { RenderResult } from './render-engine.js';

export async function renderReveal(
  templatePath: string,
  data: Record<string, any>,
): Promise<RenderResult> {
  const templateHtml = readFileSync(templatePath, 'utf-8');
  const resolvedHtml = resolvePlaceholders(templateHtml, data);

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/white.css">
  <style>
    .reveal h1, .reveal h2, .reveal h3 { text-transform: none; }
    .reveal { font-size: 28px; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
      ${resolvedHtml}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      transition: 'slide',
    });
  </script>
</body>
</html>`;

  return { buffer: Buffer.from(fullHtml), format: 'reveal' };
}
