// packages/server/src/services/composer-service.ts
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { FragmentService } from './fragment-service.js';
import type { TemplateYaml, ComposeRequest, ComposeResponse, FragmentSlot } from '../schema/template.js';

/** Result shape returned by TemplateService.getById(). */
export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  output_format: string;
  version: string;
  template_path: string;
  yaml_path: string;
  author: string;
  created_at: string;
  updated_at: string;
  git_hash: string | null;
  yaml: TemplateYaml | null;
}

/** Minimal interface matching TemplateService. */
export interface TemplateServiceLike {
  getById(id: string): Promise<TemplateRow | null>;
  getTemplatePath(row: { template_path: string }): string;
}

interface ResolvedFragment {
  id: string;
  body: string;
  quality: string;
  score: number;
}

const OUTPUT_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export class ComposerService {
  private outputsDir: string;

  constructor(
    private fragmentService: FragmentService,
    private templateService: TemplateServiceLike,
    private basePath: string,
  ) {
    this.outputsDir = join(basePath, 'outputs');
    mkdirSync(this.outputsDir, { recursive: true });
  }

  // ---------------------------------------------------------------------------
  // Static / pure methods
  // ---------------------------------------------------------------------------

  /**
   * Replace {{context.fieldname}} patterns with actual context values.
   */
  static resolveContextVars(value: string, context: Record<string, any>): string {
    return value.replace(/\{\{context\.(\w+)\}\}/g, (_match, field) => {
      const val = context[field];
      return val !== undefined ? String(val) : '';
    });
  }

  /**
   * Validate context against a schema definition.
   * Throws on missing required fields or invalid enum values.
   * Mutates `context` to apply defaults.
   */
  static validateContext(
    context: Record<string, any>,
    schema: Record<string, { type: string; required?: boolean; default?: any; enum?: string[] }>,
  ): void {
    for (const [field, def] of Object.entries(schema)) {
      // Apply defaults when field is missing
      if (context[field] === undefined || context[field] === null) {
        if (def.default !== undefined) {
          let defaultVal = def.default;
          if (defaultVal === 'today') {
            defaultVal = new Date().toISOString().slice(0, 10);
          }
          context[field] = defaultVal;
        } else if (def.required) {
          throw new Error(`Missing required context field: ${field}`);
        }
      }

      // Validate enum constraints
      if (def.enum && context[field] !== undefined) {
        if (!def.enum.includes(String(context[field]))) {
          throw new Error(
            `Context field '${field}' must be one of: ${def.enum.join(', ')}. Got: ${context[field]}`,
          );
        }
      }
    }
  }

  /**
   * Build the JSON payload that Carbone will use to render the template.
   */
  static buildCarboneJson(
    resolved: Map<string, ResolvedFragment[]>,
    context: Record<string, any>,
    structuredData?: Record<string, any>,
  ): Record<string, any> {
    const fragmentsObj: Record<string, any> = {};

    for (const [key, items] of resolved) {
      if (items.length === 1) {
        const f = items[0];
        fragmentsObj[key] = { body: f.body, id: f.id, quality: f.quality };
      } else {
        fragmentsObj[key] = items.map(f => ({ body: f.body, id: f.id, quality: f.quality }));
      }
    }

    return {
      ...(structuredData ?? {}),
      fragments: fragmentsObj,
      metadata: {
        ...context,
        generated_at: new Date().toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Instance methods
  // ---------------------------------------------------------------------------

  /**
   * Full composition flow: resolve fragments, build JSON, render with Carbone.
   */
  async compose(
    templateId: string,
    request: ComposeRequest,
    callerRole: string,
  ): Promise<ComposeResponse> {
    const startMs = Date.now();

    // 1. Load template
    const row = await this.templateService.getById(templateId);
    if (!row) {
      throw new Error(`Template not found: ${templateId}`);
    }
    if (!row.yaml) {
      throw new Error(`Template YAML not found for: ${templateId}`);
    }
    const yaml = row.yaml;

    // 2. Validate output format
    const requestedFormat = request.output?.format ?? 'docx';
    if (requestedFormat !== yaml.output_format) {
      throw new Error(
        `Output format mismatch: requested '${requestedFormat}' but template requires '${yaml.output_format}'`,
      );
    }

    // 3. Validate context
    const context = { ...request.context };
    if (yaml.context_schema) {
      ComposerService.validateContext(context, yaml.context_schema);
    }

    // 4. Resolve fragment slots
    const resolved = new Map<string, ResolvedFragment[]>();
    const resolvedList: Array<{ key: string; fragment_id: string; score: number; quality: string }> = [];
    const skipped: string[] = [];
    const warnings: string[] = [];

    for (const slot of yaml.fragments) {
      try {
        const items = await this.resolveSlot(slot, context, request.overrides);
        if (items.length === 0) {
          if (slot.fallback === 'skip') {
            skipped.push(slot.key);
            continue;
          } else if (slot.fallback === 'generate') {
            throw new Error(`Fragment generation not yet supported for slot '${slot.key}'`);
          } else {
            throw new Error(`No fragment found for required slot '${slot.key}'`);
          }
        }
        resolved.set(slot.key, items);
        for (const item of items) {
          resolvedList.push({
            key: slot.key,
            fragment_id: item.id,
            score: item.score,
            quality: item.quality,
          });
        }
      } catch (err: any) {
        if (slot.fallback === 'skip') {
          skipped.push(slot.key);
          warnings.push(`Slot '${slot.key}' skipped: ${err.message}`);
        } else {
          throw err;
        }
      }
    }

    // 5. Build Carbone JSON
    const carboneData = ComposerService.buildCarboneJson(
      resolved,
      context,
      request.structured_data,
    );

    // 6. Render with Carbone
    const templatePath = this.templateService.getTemplatePath(row);
    const carboneModule = await import('carbone');
    const carbone = carboneModule.default ?? carboneModule;
    const render = promisify(carbone.render);

    const resultBuffer = await render(templatePath, carboneData);

    // 7. Save output
    const outputFilename = request.output?.filename
      ? `${randomUUID()}-${request.output.filename}`
      : `${randomUUID()}.docx`;
    const outputPath = join(this.outputsDir, outputFilename);
    writeFileSync(outputPath, resultBuffer);

    const renderMs = Date.now() - startMs;
    const expiresAt = new Date(Date.now() + OUTPUT_TTL_MS).toISOString();

    // 8. Return response
    return {
      document_url: `/v1/outputs/${outputFilename}`,
      expires_at: expiresAt,
      template: { id: yaml.id, name: yaml.name, version: yaml.version },
      context,
      resolved: resolvedList,
      skipped,
      generated: [],
      structured_data: request.structured_data,
      warnings,
      render_ms: renderMs,
    };
  }

  /**
   * Purge output files older than TTL. Returns number of files removed.
   */
  cleanupOutputs(): number {
    let removed = 0;
    const now = Date.now();

    try {
      const files = readdirSync(this.outputsDir);
      for (const file of files) {
        const filePath = join(this.outputsDir, file);
        try {
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > OUTPUT_TTL_MS) {
            unlinkSync(filePath);
            removed++;
          }
        } catch {
          // skip files that can't be stat'd
        }
      }
    } catch {
      // outputs dir doesn't exist yet
    }

    return removed;
  }

  /**
   * Return the full path if file exists in outputs, null otherwise.
   */
  getOutputPath(filename: string): string | null {
    const fullPath = join(this.outputsDir, filename);
    return existsSync(fullPath) ? fullPath : null;
  }

  /**
   * Start periodic cleanup of expired output files.
   */
  startCleanupTimer(): NodeJS.Timeout {
    return setInterval(() => this.cleanupOutputs(), CLEANUP_INTERVAL_MS);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async resolveSlot(
    slot: FragmentSlot,
    context: Record<string, any>,
    overrides?: Record<string, string>,
  ): Promise<ResolvedFragment[]> {
    // Check for override
    if (overrides && overrides[slot.key]) {
      const frag = await this.fragmentService.getById(overrides[slot.key]);
      if (!frag) {
        throw new Error(`Override fragment '${overrides[slot.key]}' not found for slot '${slot.key}'`);
      }
      return [{
        id: frag.id,
        body: frag.body,
        quality: frag.quality,
        score: 1.0,
      }];
    }

    // Resolve context vars in lang and domain
    const lang = ComposerService.resolveContextVars(slot.lang, context);
    const domain = ComposerService.resolveContextVars(slot.domain, context);

    // Search for fragments
    const results = await this.fragmentService.search(
      slot.type,
      {
        type: [slot.type],
        domain: [domain],
        lang,
        quality_min: slot.quality_min,
      },
      slot.count,
    );

    const items: ResolvedFragment[] = [];
    for (const result of results) {
      // Load full fragment to get body
      const full = await this.fragmentService.getById(result.id);
      if (full) {
        items.push({
          id: full.id,
          body: full.body,
          quality: full.quality,
          score: result.score,
        });
      }
    }

    return items;
  }
}
