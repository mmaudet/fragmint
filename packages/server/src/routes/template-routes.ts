// packages/server/src/routes/template-routes.ts
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/middleware.js';
import type { TemplateService } from '../services/template-service.js';
import type { ComposerService } from '../services/composer-service.js';
import { ComposeRequestSchema } from '../schema/template.js';

export function templateRoutes(
  app: FastifyInstance,
  templateService: TemplateService,
  composerService: ComposerService,
  authenticate: ReturnType<typeof import('../auth/middleware.js').buildAuthMiddleware>,
) {
  // List templates
  app.get('/v1/templates', { preHandler: [authenticate, requireRole('reader')] }, async (request) => {
    const query = request.query as Record<string, string>;
    const rows = await templateService.list({
      output_format: query.output_format,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
    return { data: rows, meta: { count: rows.length }, error: null };
  });

  // Get template by ID
  app.get('/v1/templates/:id', { preHandler: [authenticate, requireRole('reader')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const template = await templateService.getById(id);
    if (!template) return reply.status(404).send({ data: null, meta: null, error: 'Template not found' });
    return { data: template, meta: null, error: null };
  });

  // Create template (multipart: .docx + .yaml)
  app.post('/v1/templates', { preHandler: [authenticate, requireRole('expert')] }, async (request, reply) => {
    let docxBuffer: Buffer | undefined;
    let yamlContent: string | undefined;
    let docxFilename: string | undefined;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        const buffers: Buffer[] = [];
        for await (const chunk of part.file) {
          buffers.push(chunk);
        }
        const buffer = Buffer.concat(buffers);

        if (part.filename.endsWith('.docx')) {
          docxBuffer = buffer;
          docxFilename = part.filename;
        } else if (part.filename.endsWith('.yaml') || part.filename.endsWith('.yml')) {
          yamlContent = buffer.toString('utf-8');
        }
      }
    }

    if (!docxBuffer || !docxFilename) {
      return reply.status(400).send({ data: null, meta: null, error: 'Missing .docx file' });
    }
    if (!yamlContent) {
      return reply.status(400).send({ data: null, meta: null, error: 'Missing .yaml file' });
    }

    const result = await templateService.create(
      docxBuffer, yamlContent, docxFilename,
      request.user.login, request.user.role, request.ip,
    );
    return reply.status(201).send({ data: result, meta: null, error: null });
  });

  // Update template (multipart: optional .docx and/or .yaml)
  app.put('/v1/templates/:id', { preHandler: [authenticate, requireRole('expert')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    let docxBuffer: Buffer | undefined;
    let yamlContent: string | undefined;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        const buffers: Buffer[] = [];
        for await (const chunk of part.file) {
          buffers.push(chunk);
        }
        const buffer = Buffer.concat(buffers);

        if (part.filename.endsWith('.docx')) {
          docxBuffer = buffer;
        } else if (part.filename.endsWith('.yaml') || part.filename.endsWith('.yml')) {
          yamlContent = buffer.toString('utf-8');
        }
      }
    }

    if (!docxBuffer && !yamlContent) {
      return reply.status(400).send({ data: null, meta: null, error: 'No files provided for update' });
    }

    const result = await templateService.update(
      id, docxBuffer, yamlContent,
      request.user.login, request.user.role, request.ip,
    );
    return { data: result, meta: null, error: null };
  });

  // Delete template
  app.delete('/v1/templates/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await templateService.delete(id, request.user.login, request.user.role, request.ip);
    return { data: result, meta: null, error: null };
  });

  // Compose document from template
  app.post('/v1/templates/:id/compose', { preHandler: [authenticate, requireRole('reader')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ComposeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ data: null, meta: null, error: parsed.error.message });
    }
    const result = await composerService.compose(id, parsed.data, request.user.role);
    return { data: result, meta: null, error: null };
  });

  // Download generated output file
  app.get('/v1/outputs/:filename', { preHandler: [authenticate, requireRole('reader')] }, async (request, reply) => {
    const { filename } = request.params as { filename: string };

    // Prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return reply.status(400).send({ data: null, meta: null, error: 'Invalid filename' });
    }

    const outputPath = composerService.getOutputPath(filename);
    if (!outputPath) {
      return reply.status(404).send({ data: null, meta: null, error: 'Output file not found' });
    }

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(createReadStream(outputPath));
  });
}
