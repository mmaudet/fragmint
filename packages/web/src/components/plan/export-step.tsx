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

type ExportFormat = 'md' | 'docx' | 'pptx' | 'slides' | 'reveal';
type MarpTheme = 'linagora' | 'default' | 'gaia' | 'uncover';
type RevealTheme = 'linagora' | 'white' | 'black' | 'moon' | 'sky' | 'beige' | 'simple' | 'solarized';

const FORMAT_OPTIONS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'docx', label: 'Word (.docx)', ext: 'docx' },
  { value: 'pptx', label: 'PowerPoint (.pptx)', ext: 'pptx' },
  { value: 'slides', label: 'Marp slides (.html)', ext: 'html' },
  { value: 'reveal', label: 'Reveal.js (.html)', ext: 'html' },
  { value: 'md', label: 'Markdown (.md)', ext: 'md' },
];

const MARP_THEMES: { value: MarpTheme; label: string }[] = [
  { value: 'linagora', label: 'Linagora' },
  { value: 'default', label: 'Default' },
  { value: 'gaia', label: 'Gaia' },
  { value: 'uncover', label: 'Uncover' },
];

const REVEAL_THEMES: { value: RevealTheme; label: string }[] = [
  { value: 'linagora', label: 'Linagora' },
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'moon', label: 'Moon' },
  { value: 'sky', label: 'Sky' },
  { value: 'beige', label: 'Beige' },
  { value: 'simple', label: 'Simple' },
  { value: 'solarized', label: 'Solarized' },
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
  const [marpTheme, setMarpTheme] = useState<MarpTheme>('linagora');
  const [revealTheme, setRevealTheme] = useState<RevealTheme>('linagora');
  const [exporting, setExporting] = useState(false);
  const styleId = plan.state.export_style_template_id ?? '';
  const defaultName = styleTemplates.data?.defaultName ?? null;
  const hasDraft = !!plan.state.draft_markdown?.trim();
  const saveTimer = useRef<number | null>(null);

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
        style_template_id: exportFormat === 'docx' ? styleId || undefined : undefined,
        marp_theme: exportFormat === 'pptx' || exportFormat === 'slides' ? marpTheme : undefined,
        reveal_theme: exportFormat === 'reveal' ? revealTheme : undefined,
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

  const isMarpFormat = exportFormat === 'pptx' || exportFormat === 'slides';
  const isRevealFormat = exportFormat === 'reveal';
  const isDocxFormat = exportFormat === 'docx';

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
            {isDocxFormat && (
              <>
                <Select
                  value={styleId || '__none__'}
                  onValueChange={(v) =>
                    update.mutate({ export_style_template_id: v === '__none__' ? null : v })
                  }
                >
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder={t('planGeneration', 'styleTemplate')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      {defaultName ? (
                        <span>
                          {defaultName}{' '}
                          <span className="text-xs text-muted-foreground ml-1">(par défaut)</span>
                        </span>
                      ) : (
                        t('planGeneration', 'defaultStyling')
                      )}
                    </SelectItem>
                    {(styleTemplates.data?.templates ?? []).map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => setUploadOpen(true)}>
                  + {t('planGeneration', 'uploadStyleTemplate')}
                </Button>
              </>
            )}

            {isMarpFormat && (
              <Select
                value={marpTheme}
                onValueChange={(v) => setMarpTheme(v as MarpTheme)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARP_THEMES.map((th) => (
                    <SelectItem key={th.value} value={th.value}>
                      {th.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {isRevealFormat && (
              <Select
                value={revealTheme}
                onValueChange={(v) => setRevealTheme(v as RevealTheme)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REVEAL_THEMES.map((th) => (
                    <SelectItem key={th.value} value={th.value}>
                      {th.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        onUploaded={(id) => update.mutate({ export_style_template_id: id })}
      />
    </div>
  );
}
