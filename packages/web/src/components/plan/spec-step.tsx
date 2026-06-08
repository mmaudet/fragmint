import { useEffect, useRef, useState } from 'react';
import type { Plan } from '@/api/types';
import { useGeneratePlan, useUpdatePlan, useValidatePlan } from '@/api/hooks/use-plans';
import { useFacets } from '@/api/hooks/use-facets';
import { useCollection } from '@/lib/collection-context';
import { useIndexStatus } from '@/api/hooks/use-index';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChipSelect } from '@/components/chip-select';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';
import { Loader2, Info, Copy, Check } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export function SpecStep({ plan, onValidated }: { plan: Plan; onValidated?: () => void }) {
  const { t } = useI18n();
  const update = useUpdatePlan(plan.id);
  const generate = useGeneratePlan(plan.id);
  const validate = useValidatePlan(plan.id);
  const { activeCollection } = useCollection();
  const { data: facets } = useFacets(activeCollection ?? 'common');
  const { data: indexStatus } = useIndexStatus();
  const retrievalMode = indexStatus?.retrieval_mode ?? 'hybrid';

  const [specPrompt, setSpecPrompt] = useState(plan.state.spec_prompt);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [copiedSpec, setCopiedSpec] = useState(false);

  function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  const [domain, setDomain] = useState<string[]>(plan.state.filters.domain ?? []);
  const [lang, setLang] = useState(plan.state.filters.lang || 'any');
  const [tags, setTags] = useState<string[]>(plan.state.filters.tags ?? []);
  const [planMarkdown, setPlanMarkdown] = useState(plan.state.plan_markdown);

  // Debounced auto-save on edits
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      update.mutate({
        spec_prompt: specPrompt,
        filters: {
          domain,
          lang: lang === 'any' ? undefined : lang || undefined,
          tags,
        },
        plan_markdown: planMarkdown,
      });
    }, 1000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specPrompt, domain, lang, tags, planMarkdown]);

  async function handleGenerate() {
    try {
      const out = await generate.mutateAsync();
      setPlanMarkdown(out.state.plan_markdown);
    } catch (e: any) {
      toast.error(`Generation failed: ${e.message ?? e}`);
    }
  }

  async function handleValidate() {
    try {
      await validate.mutateAsync();
      onValidated?.();
    } catch (e: any) {
      toast.error(`Validation failed: ${e.message ?? e}`);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('planGeneration', 'specPrompt')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <button
                onClick={() => copyToClipboard(specPrompt, setCopiedSpec)}
                className="absolute top-2 right-2 z-10 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Copier"
              >
                {copiedSpec ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <Textarea
                rows={12}
                value={specPrompt}
                onChange={(e) => setSpecPrompt(e.target.value)}
                className="pr-8"
              />
            </div>
            <Button onClick={handleGenerate} disabled={generate.isPending}>
              {generate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {plan.state.plan_markdown
                ? t('planGeneration', 'regeneratePlan')
                : t('planGeneration', 'generatePlan')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('planGeneration', 'filters')}</CardTitle>
            <p className="text-xs text-muted-foreground">{t('planGeneration', 'filtersHint')}</p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                {t('planGeneration', 'filterDomain')}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">
                      <Info className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('planGeneration', 'filterDomainTooltip')}</TooltipContent>
                </Tooltip>
              </div>
              <ChipSelect
                value={domain}
                onChange={setDomain}
                suggestions={facets?.domains ?? []}
                placeholder="twake, linagora…"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                {t('planGeneration', 'filterLang')}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">
                      <Info className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('planGeneration', 'filterLangTooltip')}</TooltipContent>
                </Tooltip>
              </div>
              <Select value={lang} onValueChange={setLang}>
                <SelectTrigger>
                  <SelectValue placeholder="Any language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="fr">French (fr)</SelectItem>
                  <SelectItem value="en">English (en)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                {t('planGeneration', 'filterTags')}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">
                      <Info className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('planGeneration', 'filterTagsTooltip')}</TooltipContent>
                </Tooltip>
              </div>
              <ChipSelect
                value={tags}
                onChange={setTags}
                suggestions={facets?.tags ?? []}
                placeholder="produit:Twake, pu:4.50…"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plan (markdown)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {planMarkdown.includes('**Type:**') && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 border rounded-md px-3 py-2.5">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {t('planGeneration', 'typeHintIntroPre')}<code className="font-mono text-[11px]">**Type:**</code>{t('planGeneration', 'typeHintIntroPost')}{' '}
                {retrievalMode === 'agentic-only'
                  ? t('planGeneration', 'typeHintAgentic')
                  : retrievalMode === 'vector-only'
                    ? t('planGeneration', 'typeHintVectorOnly')
                    : t('planGeneration', 'typeHintHybrid')}
              </span>
            </div>
          )}
          <div className="relative">
            <button
              onClick={() => copyToClipboard(planMarkdown, setCopiedMarkdown)}
              className="absolute top-2 right-2 z-10 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Copier"
            >
              {copiedMarkdown ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <Textarea
              rows={20}
              className="font-mono text-sm pr-8"
              value={planMarkdown}
              onChange={(e) => setPlanMarkdown(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={handleValidate} disabled={validate.isPending}>
          {validate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t('planGeneration', 'validatePlan')}
        </Button>
      </div>
    </div>
  );
}
