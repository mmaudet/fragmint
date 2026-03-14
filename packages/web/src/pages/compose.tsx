import { useState, useMemo } from 'react';
import { useTemplates, useTemplate } from '@/api/hooks/use-templates';
import { useCompose } from '@/api/hooks/use-compose';
import { useSearchFragments } from '@/api/hooks/use-fragments';
import { downloadBlob } from '@/api/client';
import type { Template, ComposeResponse, Fragment } from '@/api/types';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { QualityBadge } from '@/components/quality-badge';
import { SlotPreview } from '@/components/slot-preview';
import {
  FileText,
  Download,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from 'lucide-react';

function resolveVars(str: string, ctx: Record<string, string>): string {
  return str.replace(/\{\{context\.(\w+)\}\}/g, (_, k) => ctx[k] ?? '');
}

type TemplateSlot = NonNullable<Template['fragments']>[number];

interface SlotResolverProps {
  slot: TemplateSlot;
  context: Record<string, string>;
  onResolved: (key: string, fragments: Fragment[]) => void;
}

function SlotResolver({ slot, context, onResolved }: SlotResolverProps) {
  const resolvedLang = resolveVars(slot.lang, context);
  const resolvedDomain = resolveVars(slot.domain, context);
  const { data, isLoading } = useSearchFragments(slot.key, {
    type: [slot.type],
    domain: [resolvedDomain],
    lang: resolvedLang,
  });

  // Report resolved fragments up to parent
  useMemo(() => {
    if (data) {
      onResolved(slot.key, data);
    }
  }, [data, slot.key, onResolved]);

  return (
    <SlotPreview
      slot={slot}
      fragments={data ?? undefined}
      isLoading={isLoading}
      onOverride={() => {}}
    />
  );
}

async function handleDownload(url: string, filename: string) {
  const blob = await downloadBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export default function ComposePage() {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [context, setContext] = useState<Record<string, string>>({});
  const [resolvedSlots, setResolvedSlots] = useState<Record<string, Fragment[]>>({});

  const { data: templates, isLoading: templatesLoading } = useTemplates();
  const { data: template } = useTemplate(selectedTemplateId || null);
  const compose = useCompose();

  const yaml = (template as any)?.yaml as Template | undefined;
  const contextSchema: Record<string, { type: string; required?: boolean; default?: any; enum?: string[] }> = yaml?.context_schema ?? template?.context_schema ?? {};
  const slots: NonNullable<Template['fragments']> = yaml?.fragments ?? template?.fragments ?? [];

  // Check if all required context fields are filled
  const requiredContextFilled = useMemo(() => {
    return Object.entries(contextSchema).every(
      ([key, schema]) => !schema.required || (context[key] && context[key].length > 0),
    );
  }, [contextSchema, context]);

  // Check if all required slots have fragments
  const allRequiredSlotsFilled = useMemo(() => {
    return slots
      .filter((s) => s.required)
      .every((s) => resolvedSlots[s.key] && resolvedSlots[s.key].length > 0);
  }, [slots, resolvedSlots]);

  const handleTemplateSelect = (id: string) => {
    setSelectedTemplateId(id);
    setContext({});
    setResolvedSlots({});
    compose.reset();
  };

  const handleContextChange = (key: string, value: string) => {
    setContext((prev) => ({ ...prev, [key]: value }));
  };

  const handleSlotResolved = useMemo(
    () => (key: string, fragments: Fragment[]) => {
      setResolvedSlots((prev) => {
        if (prev[key] === fragments) return prev;
        return { ...prev, [key]: fragments };
      });
    },
    [],
  );

  const handleCompose = () => {
    if (!selectedTemplateId) return;
    // Filter out empty context values
    const cleanContext: Record<string, string> = {};
    for (const [k, v] of Object.entries(context)) {
      if (v) cleanContext[k] = v;
    }
    // Apply defaults from schema
    for (const [k, schema] of Object.entries(contextSchema)) {
      if (!cleanContext[k] && schema.default) {
        cleanContext[k] = String(schema.default);
      }
    }
    compose.mutate({ templateId: selectedTemplateId, context: cleanContext });
  };

  return (
    <div className="space-y-6 p-6">
      <h2 className="text-2xl font-bold">Compositeur</h2>

      {/* Section 1 - Template selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Choix du template
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedTemplateId}
            onValueChange={handleTemplateSelect}
          >
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Choisir un template..." />
            </SelectTrigger>
            <SelectContent>
              {templatesLoading && (
                <SelectItem value="__loading" disabled>
                  Chargement...
                </SelectItem>
              )}
              {templates?.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {template && (
            <div className="mt-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{template.name}</p>
              {template.description && <p className="mt-1">{template.description}</p>}
              <div className="mt-1 flex gap-2">
                <Badge variant="outline">v{template.version}</Badge>
                <Badge variant="outline">{template.output_format}</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2 - Context form */}
      {template && Object.keys(contextSchema).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Contexte</CardTitle>
            <CardDescription>
              Renseignez les variables de contexte pour la composition
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(contextSchema).map(([key, schema]) => (
              <div key={key} className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`ctx-${key}`}>
                  {key}
                  {schema.required && <span className="ml-1 text-red-500">*</span>}
                </label>
                {schema.enum ? (
                  <Select
                    value={context[key] || schema.default?.toString() || ''}
                    onValueChange={(v) => handleContextChange(key, v)}
                  >
                    <SelectTrigger id={`ctx-${key}`} className="w-full max-w-md">
                      <SelectValue placeholder={`Choisir ${key}...`} />
                    </SelectTrigger>
                    <SelectContent>
                      {schema.enum.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`ctx-${key}`}
                    className="max-w-md"
                    value={context[key] || schema.default?.toString() || ''}
                    onChange={(e) => handleContextChange(key, e.target.value)}
                    placeholder={key}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Section 3 - Slot preview */}
      {template && requiredContextFilled && slots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Slots du template</CardTitle>
            <CardDescription>
              Fragments resolus pour chaque slot
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {slots.map((slot) => (
              <SlotResolver
                key={slot.key}
                slot={slot}
                context={context}
                onResolved={handleSlotResolved}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Section 4 - Compose button + result */}
      {template && requiredContextFilled && (
        <>
          <div className="flex items-center gap-4">
            <Button
              size="lg"
              disabled={!allRequiredSlotsFilled || compose.isPending}
              onClick={handleCompose}
            >
              {compose.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Composition en cours...
                </>
              ) : (
                'Composer le document'
              )}
            </Button>
            {!allRequiredSlotsFilled && (
              <p className="text-sm text-muted-foreground">
                Tous les slots requis doivent avoir au moins un fragment.
              </p>
            )}
          </div>

          {compose.isError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <p className="text-sm text-red-600">
                  Erreur: {(compose.error as Error).message}
                </p>
              </CardContent>
            </Card>
          )}

          {compose.isSuccess && compose.data && (
            <ComposeReport result={compose.data} />
          )}
        </>
      )}
    </div>
  );
}

function ComposeReport({ result }: { result: ComposeResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          Composition terminee
        </CardTitle>
        <CardDescription>
          {result.template.name} v{result.template.version}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Resolved fragments */}
        {result.resolved.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Fragments resolus</h4>
            <div className="space-y-1">
              {result.resolved.map((r) => (
                <div key={r.key} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span className="font-mono text-xs">{r.key}</span>
                  <QualityBadge quality={r.quality as any} />
                  <span className="text-muted-foreground text-xs">
                    score: {r.score.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skipped slots */}
        {result.skipped.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Slots ignores</h4>
            <div className="flex flex-wrap gap-1">
              {result.skipped.map((s) => (
                <Badge key={s} variant="outline" className="text-xs">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Avertissements
            </h4>
            <ul className="space-y-1 text-sm text-amber-700">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <Separator />

        {/* Render time + download */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {result.render_ms} ms
          </span>
          <Button
            onClick={() =>
              handleDownload(
                result.document_url,
                `${result.template.name}-${result.template.version}.docx`,
              )
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Telecharger
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
