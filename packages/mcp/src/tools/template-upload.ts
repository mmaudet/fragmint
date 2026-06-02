// packages/mcp/src/tools/template-upload.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { cache } from '../cache/cache-manager.js';

export const templateUploadDefinition: ToolDefinition = {
  name: 'template_upload',
  description:
    'Upload a template to the Fragmint template library. ' +
    'Provide a .docx file for DOCX style references (used with plan_export format=docx). ' +
    'Provide a .md file for Marp slide templates (used with plan_export format=pptx). ' +
    'Returns the created template ID to use in plan_export.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the template file (.docx for Word style, .md for Marp slides)',
      },
      name: {
        type: 'string',
        description: 'Display name for the template (e.g. "Offre commerciale Linagora")',
      },
      description: {
        type: 'string',
        description: 'Optional description of the template purpose',
      },
    },
    required: ['file_path', 'name'],
  },
};

export function templateUploadHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const { file_path, name, description } = args as {
        file_path: string;
        name: string;
        description?: string;
      };

      const { readFileSync } = await import('node:fs');
      const { basename, extname } = await import('node:path');

      const ext = extname(file_path).toLowerCase();
      const kind = ext === '.md' ? 'marp' : 'style_reference';
      const endpoint = kind === 'marp' ? '/v1/templates/marp' : '/v1/templates/style-reference';

      const form = new FormData();
      form.append('file', new Blob([readFileSync(file_path)]), basename(file_path));
      form.append('name', name);
      if (description) form.append('description', description);

      const result = await client.postMultipart<{
        id: string;
        name?: string;
        template_path: string;
        description?: string | null;
        warnings?: string[];
      }>(endpoint, form);

      cache.invalidate('templates:');

      return toolSuccess({
        id: result.id,
        name: result.name ?? name,
        template_path: result.template_path,
        description: result.description ?? description ?? null,
        warnings: result.warnings ?? [],
        kind,
      });
    } catch (err) {
      return toolError(
        `Template upload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
