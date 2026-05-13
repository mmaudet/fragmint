import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Plan } from '@/api/types';
import { useGeneratePlan, useUpdatePlan, useValidatePlan } from '@/api/hooks/use-plans';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';

export function SpecStep({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const update = useUpdatePlan(plan.id);
  const generate = useGeneratePlan(plan.id);
  const validate = useValidatePlan(plan.id);

  const [specPrompt, setSpecPrompt] = useState(plan.state.spec_prompt);
  const [domain, setDomain] = useState(plan.state.filters.domain ?? '');
  const [lang, setLang] = useState(plan.state.filters.lang ?? '');
  const [type, setType] = useState(plan.state.filters.type ?? '');
  const [tagsStr, setTagsStr] = useState((plan.state.filters.tags ?? []).join(', '));
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
          domain: domain || undefined,
          lang: lang || undefined,
          type: type || undefined,
          tags: tagsStr.split(',').map((s) => s.trim()).filter(Boolean),
        },
        plan_markdown: planMarkdown,
      });
    }, 1000);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specPrompt, domain, lang, type, tagsStr, planMarkdown]);

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
          <CardHeader><CardTitle>{t('planGeneration', 'filters')}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Input placeholder="domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <Input placeholder="lang (e.g. fr)" value={lang} onChange={(e) => setLang(e.target.value)} />
            <Input placeholder="type" value={type} onChange={(e) => setType(e.target.value)} />
            <Input placeholder="tags (comma-separated)" value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} />
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
          {t('planGeneration', 'validatePlan')}
        </Button>
      </div>
    </div>
  );
}
