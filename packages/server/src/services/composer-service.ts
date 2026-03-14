/**
 * Composition engine: resolves fragment slots, builds template data,
 * and renders documents via the unified render engine.
 */
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FragmentService } from './fragment-service.js';
import type { TemplateYaml, ComposeRequest, ComposeResponse, FragmentSlot } from '../schema/template.js';
import { renderDocument, type SupportedFormat } from './render-engine.js';

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
  tags?: string[];
}

const OUTPUT_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Format a number using French locale conventions:
 * space as thousands separator, comma as decimal, always 2 decimals.
 * E.g. 1234.5 → "1 234,50", 15000 → "15 000,00"
 */
export function formatFrenchNumber(n: number): string {
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

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
   * Parse structured key:value tags from a fragment's tags array.
   * E.g. ["produit:Twake Workplace", "pu:4.50"] → { produit: "Twake Workplace", pu: "4.50" }
   */
  static parseStructuredTags(tags: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const tag of tags) {
      const colonIdx = tag.indexOf(':');
      if (colonIdx > 0) {
        result[tag.slice(0, colonIdx)] = tag.slice(colonIdx + 1);
      }
    }
    return result;
  }

  /**
   * Build the data object for the rendering engine.
   * docx-templates uses flat data access: {fieldName} or +++FOR row IN rows+++
   */
  static buildTemplateData(
    resolved: Map<string, ResolvedFragment[]>,
    context: Record<string, any>,
    structuredData?: Record<string, any>,
  ): Record<string, any> {
    const quantities: Record<string, number> | undefined = structuredData?.quantities;
    const fragments: Record<string, any> = {};

    const enrichFragment = (f: ResolvedFragment) => {
      const parsed = ComposerService.parseStructuredTags(f.tags ?? []);
      const obj: Record<string, any> = {
        body: f.body,
        id: f.id,
        quality: f.quality,
        ...parsed,
      };

      // If the fragment has a unit price tag and a quantity is provided, compute pricing fields
      if (parsed.pu && quantities && quantities[f.id] !== undefined) {
        const pu = parseFloat(parsed.pu);
        const qte = quantities[f.id];
        const total = qte * pu;
        obj.pu = formatFrenchNumber(pu);
        obj.qte = qte;
        obj.total = formatFrenchNumber(total);
      }

      return obj;
    };

    for (const [key, items] of resolved) {
      if (items.length === 1) {
        fragments[key] = enrichFragment(items[0]);
      } else {
        fragments[key] = items.map(enrichFragment);
      }
    }

    return {
      ...(structuredData ?? {}),
      fragments,
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
   * Full composition flow: resolve fragments, build data, render document.
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

    // 5. Build template data
    const templateData = ComposerService.buildTemplateData(
      resolved,
      context,
      request.structured_data,
    );

    // 6. Render with unified engine
    const templatePath = this.templateService.getTemplatePath(row);
    const { buffer } = await renderDocument(
      templatePath,
      templateData,
      requestedFormat as SupportedFormat,
    );

    // 7. Save output
    const outputFilename = request.output?.filename
      ? `${randomUUID()}-${request.output.filename}`
      : `${randomUUID()}.${requestedFormat}`;
    const outputPath = join(this.outputsDir, outputFilename);
    writeFileSync(outputPath, buffer);

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

  /** Purge output files older than TTL. */
  cleanupOutputs(): number {
    let removed = 0;
    const now = Date.now();
    try {
      for (const file of readdirSync(this.outputsDir)) {
        const filePath = join(this.outputsDir, file);
        try {
          if (now - statSync(filePath).mtimeMs > OUTPUT_TTL_MS) {
            unlinkSync(filePath);
            removed++;
          }
        } catch { /* skip */ }
      }
    } catch { /* dir missing */ }
    return removed;
  }

  /** Return full path if file exists in outputs, null otherwise. */
  getOutputPath(filename: string): string | null {
    const fullPath = join(this.outputsDir, filename);
    return existsSync(fullPath) ? fullPath : null;
  }

  /** Start periodic cleanup of expired output files. */
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
        tags: frag.frontmatter?.tags ?? [],
      }];
    }

    const lang = ComposerService.resolveContextVars(slot.lang, context);
    const domain = ComposerService.resolveContextVars(slot.domain, context);

    const results = await this.fragmentService.search(
      slot.type,
      { type: [slot.type], domain: [domain], lang, quality_min: slot.quality_min },
      slot.count,
    );

    const items: ResolvedFragment[] = [];
    for (const result of results) {
      const full = await this.fragmentService.getById(result.id);
      if (full) {
        items.push({
          id: full.id,
          body: full.body,
          quality: full.quality,
          score: result.score,
          tags: full.frontmatter?.tags ?? [],
        });
      }
    }

    return items;
  }
}
