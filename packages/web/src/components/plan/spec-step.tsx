import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Plan } from '@/api/types';
import { useGeneratePlan, useUpdatePlan, useValidatePlan } from '@/api/hooks/use-plans';
import { useFacets } from '@/api/hooks/use-facets';
import { useCollection } from '@/lib/collection-context';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChipSelect } from '@/components/chip-select';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';
import { Loader2, Info } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export function SpecStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const update = useUpdatePlan(plan.id);
  const generate = useGeneratePlan(plan.id);
  const validate = useValidatePlan(plan.id);
  const { activeCollection } = useCollection();
  const { data: facets } = useFacets(activeCollection ?? 'common');

  const [specPrompt, setSpecPrompt] = useState(plan.state.spec_prompt);
  const [domain, setDomain] = useState<string[]>(plan.state.filters.domain ?? []);
  const [lang, setLang] = useState(plan.state.filters.lang || 'any');
  const [tags, setTags] = useState<string[]>(plan.state.filters.tags ?? []);
  const [refinement, setRefinement] = useState('');
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
      const out = await generate.mutateAsync({ extra_instructions: refinement || undefined });
      setPlanMarkdown(out.state.plan_markdown);
    } catch (e: any) {
      toast.error(`Generation failed: ${e.message ?? e}`);
    }
  }

  async function handleValidate() {
    try {
      await validate.mutateAsync();
      nav(`/plan-generation?id=${plan.id}`, { replace: true });
      // Workspace will switch to step 2 once status is plan_validated
    } catch (e: any) {
      toast.error(`Validation failed: ${e.message ?? e}`);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>{t('planGeneration', 'specPrompt')}</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={12} value={specPrompt} onChange={(e) => setSpecPrompt(e.target.value)} />
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
                <Tooltip><TooltipTrigger asChild><span className="cursor-help"><Info className="h-3 w-3" /></span></TooltipTrigger><TooltipContent>{t('planGeneration', 'filterDomainTooltip')}</TooltipContent></Tooltip>
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
                <Tooltip><TooltipTrigger asChild><span className="cursor-help"><Info className="h-3 w-3" /></span></TooltipTrigger><TooltipContent>{t('planGeneration', 'filterLangTooltip')}</TooltipContent></Tooltip>
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
                <Tooltip><TooltipTrigger asChild><span className="cursor-help"><Info className="h-3 w-3" /></span></TooltipTrigger><TooltipContent>{t('planGeneration', 'filterTagsTooltip')}</TooltipContent></Tooltip>
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
        <CardHeader><CardTitle>{t('planGeneration', 'refinementInstructions')}</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            placeholder="(optional) e.g. add a section about pricing"
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
          />
          <Button className="mt-3" onClick={handleGenerate} disabled={generate.isPending}>
            {generate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {plan.state.plan_markdown ? t('planGeneration', 'regeneratePlan') : t('planGeneration', 'generatePlan')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Plan (markdown)</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={20}
            className="font-mono text-sm"
            value={planMarkdown}
            onChange={(e) => setPlanMarkdown(e.target.value)}
          />
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
