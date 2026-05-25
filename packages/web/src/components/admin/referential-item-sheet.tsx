import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { Loader2 } from 'lucide-react';

export interface SheetInitialItem {
  label: string;
  status: string;
  trustSource: string;
  usageCount: number;
  proposedBy?: string;
  proposedByDisplay?: string | null;
  proposedByRole?: string | null;
  createdAt?: string;
  aliases?: string[];
}

interface Props {
  type: string;
  id: string | number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialItem?: SheetInitialItem;
}

const STATUS_CLASSES: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-800',
  archived: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

const TRUST_CLASSES: Record<string, string> = {
  'human-direct': 'bg-green-100 text-green-800',
  'llm-confirmed': 'bg-blue-100 text-blue-800',
  'llm-deviation': 'bg-amber-100 text-amber-800',
  'llm-inferred': 'bg-sky-100 text-sky-800',
};

const STATUS_KEYS: Record<string, 'statusActive' | 'statusPending' | 'statusArchived' | 'statusRejected'> = {
  active: 'statusActive', pending: 'statusPending', archived: 'statusArchived', rejected: 'statusRejected',
};

const TRUST_KEYS: Record<string, 'trustHuman' | 'trustLlmConfirmed' | 'trustLlmInferred' | 'trustLlmDeviation'> = {
  'human-direct': 'trustHuman', 'llm-confirmed': 'trustLlmConfirmed',
  'llm-inferred': 'trustLlmInferred', 'llm-deviation': 'trustLlmDeviation',
};

const TRUST_TOOLTIP_KEYS: Record<string, 'trustTooltipHuman' | 'trustTooltipConfirmed' | 'trustTooltipInferred' | 'trustTooltipDeviation'> = {
  'human-direct': 'trustTooltipHuman', 'llm-confirmed': 'trustTooltipConfirmed',
  'llm-inferred': 'trustTooltipInferred', 'llm-deviation': 'trustTooltipDeviation',
};

const QUALITY_KEYS: Record<string, 'qualityDraft' | 'qualityReviewed' | 'qualityApproved'> = {
  draft: 'qualityDraft', reviewed: 'qualityReviewed', approved: 'qualityApproved',
};

const QUALITY_TOOLTIP_KEYS: Record<string, 'qualityTooltipDraft' | 'qualityTooltipReviewed' | 'qualityTooltipApproved'> = {
  draft: 'qualityTooltipDraft', reviewed: 'qualityTooltipReviewed', approved: 'qualityTooltipApproved',
};

export function ReferentialItemSheet({ type, id, open, onOpenChange, initialItem }: Props) {
  const { t } = useI18n();

  const { data, isFetching, isError } = useQuery({
    queryKey: ['referential-detail', type, id],
    queryFn: () => apiRequest<any>('GET', `/v1/admin/referential/${type}/${id}`),
    enabled: open,
    staleTime: 1000 * 60 * 5,
  });

  // Show fetched data if available, fall back to initialItem for instant display
  const item = data?.item ?? initialItem;
  const linkedFragments: any[] = data?.linked_fragments ?? [];
  const renameHistory: any[] = data?.rename_history ?? [];
  const fragmentsLoaded = !!data;

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col overflow-hidden">
        {!item ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common', 'loading')}
          </div>
        ) : (
          <>
            <SheetHeader className="pb-4 border-b shrink-0">
              <SheetTitle className="flex items-center gap-2 flex-wrap">
                <code className="text-lg font-semibold px-1.5 py-0.5 bg-muted rounded">{item.label}</code>
                <span className="text-sm font-normal text-muted-foreground">({type})</span>
                <span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASSES[item.status] ?? 'bg-muted text-muted-foreground'}`}>
                  {STATUS_KEYS[item.status] ? t('admin', STATUS_KEYS[item.status]) : item.status}
                </span>
              </SheetTitle>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto py-4 space-y-6">
              <section>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t('admin', 'detailTrustSource')}</dt>
                  <dd>
                    <Tooltip>
                      <span className={`text-xs px-2 py-0.5 rounded cursor-help ${TRUST_CLASSES[item.trustSource] ?? 'bg-muted text-muted-foreground'}`}>
                        {TRUST_KEYS[item.trustSource] ? t('admin', TRUST_KEYS[item.trustSource]) : item.trustSource}
                      </span>
                      {TRUST_TOOLTIP_KEYS[item.trustSource] && (
                        <TooltipContent side="right" className="max-w-xs">{t('admin', TRUST_TOOLTIP_KEYS[item.trustSource])}</TooltipContent>
                      )}
                    </Tooltip>
                  </dd>
                  <dt className="text-muted-foreground">{t('admin', 'detailUsages')}</dt>
                  <dd>{item.usageCount} {item.usageCount === 1 ? 'fragment' : 'fragments'}</dd>
                  {item.proposedBy && (
                    <>
                      <dt className="text-muted-foreground">{t('admin', 'detailCreatedBy')}</dt>
                      <dd>
                        {item.proposedBy === 'llm-auto' ? (
                          <Tooltip>
                            <span className="cursor-help underline decoration-dotted">{t('admin', 'llmAutoLabel')}</span>
                            <TooltipContent side="top">{t('admin', 'llmAutoTooltip')}</TooltipContent>
                          </Tooltip>
                        ) : (
                          item.proposedByDisplay ?? item.proposedBy
                        )}
                      </dd>
                    </>
                  )}
                  {item.createdAt && (
                    <>
                      <dt className="text-muted-foreground">{t('admin', 'detailCreatedAt')}</dt>
                      <dd>{new Date(item.createdAt).toLocaleDateString()}</dd>
                    </>
                  )}
                  {item.aliases && item.aliases.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">Alias</dt>
                      <dd className="italic">{item.aliases.join(', ')}</dd>
                    </>
                  )}
                </dl>
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                  {t('admin', 'linkedFragments')}
                  {fragmentsLoaded
                    ? <span className="font-normal text-muted-foreground">({linkedFragments.length})</span>
                    : isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  }
                </h3>
                <p className="text-xs text-muted-foreground mb-3">{t('admin', 'linkedFragmentsHint')}</p>
                {!fragmentsLoaded ? (
                  isFetching ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('common', 'loading')}
                    </div>
                  ) : isError ? (
                    <p className="text-sm text-destructive">{t('admin', 'loadError')}</p>
                  ) : null
                ) : linkedFragments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('admin', 'noLinkedFragments')}</p>
                ) : (
                  <ul className="space-y-4">
                    {linkedFragments.map((f: any) => {
                      const qualityKey = QUALITY_KEYS[f.quality];
                      return (
                        <li key={f.id} className="border-l-2 border-muted pl-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium line-clamp-1">{f.title || f.id}</span>
                            {f.quality && (
                              <Tooltip>
                                <Badge variant="secondary" className="text-xs shrink-0 cursor-help">
                                  {qualityKey ? t('admin', qualityKey) : f.quality}
                                </Badge>
                                {QUALITY_TOOLTIP_KEYS[f.quality] && (
                                  <TooltipContent side="top">{t('admin', QUALITY_TOOLTIP_KEYS[f.quality])}</TooltipContent>
                                )}
                              </Tooltip>
                            )}
                          </div>
                          {f.body_excerpt && (
                            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{f.body_excerpt}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {renameHistory.length > 0 && (
                <section>
                  <h3 className="font-semibold text-sm mb-2">{t('admin', 'renameHistory')}</h3>
                  <ul className="space-y-2">
                    {renameHistory.map((r: any) => (
                      <li key={r.id} className="border-l-2 border-muted pl-3 text-sm">
                        <span className="font-mono">{r.old_value}</span>{' → '}<span className="font-mono">{r.new_value}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Par {r.renamed_by} · {new Date(r.renamed_at).toLocaleDateString()} · {r.affected_fragments} fragments
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
