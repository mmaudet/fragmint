import { useEffect, useRef, useState } from 'react';
import type { Plan } from '@/api/types';
import { useAssemble, useUpdatePlan, exportPlan } from '@/api/hooks/use-plans';
import { useStyleTemplates } from '@/api/hooks/use-style-templates';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { UploadStyleTemplateDialog } from './upload-style-template-dialog';
import { toast } from 'sonner';

type ExportFormat = 'md' | 'docx' | 'pptx';

const FORMAT_OPTIONS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'docx', label: 'Word (.docx)', ext: 'docx' },
  { value: 'pptx', label: 'PowerPoint (.pptx)', ext: 'pptx' },
  { value: 'md', label: 'Markdown (.md)', ext: 'md' },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const update = useUpdatePlan(plan.id);
  const assemble = useAssemble(plan.id);
  const styleTemplates = useStyleTemplates();
  const [draft, setDraft] = useState(plan.state.draft_markdown ?? '');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('docx');
  const [exporting, setExporting] = useState(false);
  const styleId = plan.state.export_style_template_id ?? '';
  const defaultName = styleTemplates.data?.defaultName ?? null;
  const hasDraft = !!plan.state.draft_markdown?.trim();
  const saveTimer = useRef<number | null>(null);

  // Sync export format with the template stored on the plan (e.g. pptx template saved in a
  // previous session — without this, the dropdown shows blank because the pptx template isn't
  // in the docx visibleTemplates list).
  useEffect(() => {
    if (!styleId || !styleTemplates.data) return;
    const tpl = styleTemplates.data.templates.find((t) => t.id === styleId);
    if (tpl && tpl.output_format !== exportFormat) {
      setExportFormat(tpl.output_format as ExportFormat);
    }
  }, [styleTemplates.data, styleId]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  async function handleReassemble() {
    if (plan.state.draft_dirty && !confirm('This will overwrite your manual edits. Continue?'))
      return;
    try {
      const out = await assemble.mutateAsync();
      setDraft(out.state.draft_markdown ?? '');
    } catch (e: any) {
      toast.error(`Assemble failed: ${e.message ?? e}`);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const opt = FORMAT_OPTIONS.find((f) => f.value === exportFormat)!;
      const blob = await exportPlan(plan.id, exportFormat, {
        style_template_id: hasStyleTemplate ? effectiveStyleId || undefined : undefined,
      });
      downloadBlob(blob, `${plan.title || 'plan'}.${opt.ext}`);
    } catch (e: any) {
      toast.error(`Export failed: ${e.message ?? e}`);
    } finally {
      setExporting(false);
    }
  }

  function onDraftChange(v: string) {
    setDraft(v);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      update.mutate({ draft_markdown: v, draft_dirty: true });
    }, 500);
  }

  const hasStyleTemplate = exportFormat === 'docx' || exportFormat === 'pptx';
  const isDocxFormat = exportFormat === 'docx';

  // Templates filtered by current export format (docx templates for Word, pptx for PowerPoint)
  const visibleTemplates = (styleTemplates.data?.templates ?? []).filter(
    (tpl) => tpl.output_format === exportFormat,
  );

  // If the stored template doesn't match the current format, fall back to the first visible
  // template for that format (or '' = default/none). Does NOT mutate plan state so switching
  // docx ↔ pptx preserves both selections.
  const effectiveStyleId = visibleTemplates.some((t) => t.id === styleId)
    ? styleId
    : (visibleTemplates[0]?.id ?? '');

  return (
    <div className="p-6 space-y-4">
      <div className="space-y-3">
        <div>
          <Button variant="outline" onClick={handleReassemble} disabled={assemble.isPending}>
            {t('planGeneration', 'assemble')}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Left: style/theme options depending on format */}
          <div className="flex items-center gap-2 flex-wrap">
            {hasStyleTemplate && (
              <>
                <Select
                  value={effectiveStyleId || '__none__'}
                  onValueChange={(v) => {
                    if (v === '__none__') {
                      update.mutate({ export_style_template_id: null });
                      return;
                    }
                    const tpl = styleTemplates.data?.templates.find((t) => t.id === v);
                    if (tpl && tpl.output_format !== exportFormat) {
                      setExportFormat(tpl.output_format as ExportFormat);
                    }
                    update.mutate({ export_style_template_id: v });
                  }}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder={t('planGeneration', 'styleTemplate')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="flex items-center gap-2">
                        {isDocxFormat && defaultName
                          ? defaultName
                          : <span className="text-muted-foreground">{t('planGeneration', 'pandocDefault')}</span>
                        }
                        <span className="text-xs font-mono text-muted-foreground">.{exportFormat}</span>
                        {isDocxFormat && defaultName && (
                          <span className="text-xs text-muted-foreground">{t('planGeneration', 'builtinDefault')}</span>
                        )}
                      </span>
                    </SelectItem>
                    {visibleTemplates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        <span className="flex items-center gap-2">
                          {tpl.name}
                          <span className="text-xs text-muted-foreground font-mono">
                            .{tpl.output_format}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => setUploadOpen(true)}>
                  + {t('planGeneration', 'uploadStyleTemplate')}
                </Button>
              </>
            )}

          </div>

          {/* Right: format selector + download button */}
          <div className="flex items-center gap-2">
            <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as ExportFormat)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleExport} disabled={!hasDraft || exporting}>
              {exporting ? 'Génération…' : 'Télécharger'}
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Final markdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={32}
            className="font-mono text-sm"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
          />
        </CardContent>
      </Card>

      <UploadStyleTemplateDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(id, outputFormat) => {
          if (outputFormat !== exportFormat) setExportFormat(outputFormat as ExportFormat);
          update.mutate({ export_style_template_id: id });
        }}
      />
    </div>
  );
}
