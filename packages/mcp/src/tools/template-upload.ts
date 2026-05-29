// packages/mcp/src/tools/template-upload.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';

export const templateUploadDefinition: ToolDefinition = {
  name: 'template_upload',
  description:
    'Upload a DOCX style-reference template to the Fragmint template library. The file becomes available for document composition. Returns the created template record and any style warnings.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the .docx file to upload as a style-reference template',
      },
      name: {
        type: 'string',
        description: 'Display name for the template (e.g. "Offre commerciale LinAgora")',
      },
      description: {
        type: 'string',
        description: 'Optional description of the template purpose or usage',
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
      const { basename } = await import('node:path');

      const form = new FormData();
      form.append('file', new Blob([readFileSync(file_path)]), basename(file_path));
      form.append('name', name);
      if (description) form.append('description', description);

      const result = await client.postMultipart<{
        id: string;
        name: string;
        filename: string;
        description: string | null;
        warnings: string[];
      }>('/v1/templates/style-reference', form);

      return toolSuccess({
        id: result.id,
        name: result.name,
        filename: result.filename,
        description: result.description,
        warnings: result.warnings ?? [],
      });
    } catch (err) {
      return toolError(
        `Template upload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}
