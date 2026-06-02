import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetClose, SheetTitle } from '@/components/ui/sheet';
import { Loader2, ExternalLink, Pencil, Check, X } from 'lucide-react';
import { useApproveProposal, useRejectProposal } from '@/api/hooks/use-metadata-proposals';
import { RenameDialog } from './metadata/rename-dialog';
import { MergeDialog } from './metadata/merge-dialog';

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
  category?: string;
  flags?: { type: string; label: string }[];
}

interface Props {
  type: string;
  id: string | number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialItem?: SheetInitialItem;
  onRefresh?: () => void;
}

const STATUS_CLASSES: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  archived: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const TRUST_CLASSES: Record<string, string> = {
  'human-direct': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  'llm-confirmed': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'llm-deviation': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'llm-inferred': 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
};

const STATUS_KEYS: Record<
  string,
  'statusActive' | 'statusPending' | 'statusArchived' | 'statusRejected'
> = {
  active: 'statusActive',
  pending: 'statusPending',
  archived: 'statusArchived',
  rejected: 'statusRejected',
};

const TRUST_KEYS: Record<
  string,
  'trustHuman' | 'trustLlmConfirmed' | 'trustLlmInferred' | 'trustLlmDeviation'
> = {
  'human-direct': 'trustHuman',
  'llm-confirmed': 'trustLlmConfirmed',
  'llm-inferred': 'trustLlmInferred',
  'llm-deviation': 'trustLlmDeviation',
};

const TRUST_TOOLTIP_KEYS: Record<
  string,
  'trustTooltipHuman' | 'trustTooltipConfirmed' | 'trustTooltipInferred' | 'trustTooltipDeviation'
> = {
  'human-direct': 'trustTooltipHuman',
  'llm-confirmed': 'trustTooltipConfirmed',
  'llm-inferred': 'trustTooltipInferred',
  'llm-deviation': 'trustTooltipDeviation',
};

const QUALITY_KEYS: Record<string, 'qualityDraft' | 'qualityReviewed' | 'qualityApproved'> = {
  draft: 'qualityDraft',
  reviewed: 'qualityReviewed',
  approved: 'qualityApproved',
};

const QUALITY_TOOLTIP_KEYS: Record<
  string,
  'qualityTooltipDraft' | 'qualityTooltipReviewed' | 'qualityTooltipApproved'
> = {
  draft: 'qualityTooltipDraft',
  reviewed: 'qualityTooltipReviewed',
  approved: 'qualityTooltipApproved',
};

function shouldShowExcerpt(title: string | undefined, excerpt: string): boolean {
  const prefix = (title ?? '').trim().slice(0, 40);
  return prefix.length === 0 || !excerpt.trim().startsWith(prefix);
}

export function ReferentialItemSheet({
  type,
  id,
  open,
  onOpenChange,
  initialItem,
  onRefresh,
}: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(false);
  const [categorySelect, setCategorySelect] = useState(''); // predefined or '__custom__' or ''
  const [categoryCustom, setCategoryCustom] = useState(''); // free text when '__custom__'
  const TAG_CATEGORIES = ['client', 'produit', 'tech', 'partner', 'cert', 'reg'];
  const categoryDraft = categorySelect === '__custom__' ? categoryCustom : categorySelect;
  const approve = useApproveProposal();
  const reject = useRejectProposal();

  const { data, isFetching, isError } = useQuery({
    queryKey: ['referential-detail', type, id],
    queryFn: () => apiRequest<any>('GET', `/v1/admin/referential/${type}/${id}`),
    enabled: open,
    staleTime: 1000 * 60 * 5,
  });

  const updateCategory = useMutation({
    mutationFn: (category: string | null) =>
      apiRequest('PATCH', `/v1/admin/referential/${type}/${id}/category`, { category }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referential-detail', type, id] });
      setEditingCategory(false);
    },
  });

  const item = data?.item ?? initialItem;
  const linkedFragments: any[] = data?.linked_fragments ?? [];
  const renameHistory: any[] = data?.rename_history ?? [];
  const fragmentsLoaded = !!data;
  const actualUsageCount = fragmentsLoaded ? linkedFragments.length : (item?.usageCount ?? 0);
  const rawCategory = (data?.item ?? item)?.category;
  const slugPrefix = String(item.id).includes(':') ? String(item.id).split(':')[0] : null;
  const currentCategory = (rawCategory && rawCategory !== 'proposed') ? rawCategory : (slugPrefix ?? rawCategory);

  const proposalForDialogs = item
    ? {
        id,
        kind: type,
        name: item.label?.replace(/^NEW:\s*/i, ''),
        label: item.label?.replace(/^NEW:\s*/i, ''),
        entity_type: currentCategory,
        usage_count: actualUsageCount,
        proposed_by: item.proposedBy ?? '',
        created_at: item.createdAt ?? '',
        flags: item.flags ?? [],
        trust_source: item.trustSource,
      }
    : null;

  async function handleApprove() {
    if (editingCategory) {
      try {
        await updateCategory.mutateAsync(categoryDraft || null);
      } catch {
        return; // updateCategory.onError already handles the error
      }
    }
    approve.mutate(
      { id: String(id), kind: type as any },
      {
        onSuccess: () => {
          onRefresh?.();
          qc.invalidateQueries({ queryKey: ['referential-detail', type, id] });
        },
      },
    );
  }
  function handleReject() {
    reject.mutate(
      { id: String(id), kind: type as any },
      {
        onSuccess: () => {
          onRefresh?.();
          qc.invalidateQueries({ queryKey: ['referential-detail', type, id] });
        },
      },
    );
  }

  const isPending = item?.status === 'pending';
  const isActive = item?.status === 'active';
  const showFooter = item && (isPending || isActive);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-[640px] sm:max-w-[640px] gap-0 p-0 flex flex-col"
      >
        <SheetTitle className="sr-only">Détail {type}</SheetTitle>

        {/* Header — sticky */}
        <div className="shrink-0 bg-background border-b px-5 py-3 flex items-center justify-between z-10">
          <SheetClose asChild>
            <button className="text-sm hover:underline text-muted-foreground">
              ← {t('common', 'close')}
            </button>
          </SheetClose>
          {item && (
            <span
              className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_CLASSES[item.status] ?? 'bg-muted text-muted-foreground'}`}
            >
              {STATUS_KEYS[item.status] ? t('admin', STATUS_KEYS[item.status]) : item.status}
            </span>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {!item ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common', 'loading')}
            </div>
          ) : (
            <>
              {/* Title */}
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-lg font-semibold px-1.5 py-0.5 bg-muted rounded">
                  {item.label.replace(/^NEW:\s*/i, '')}
                </code>
                <span className="text-sm text-muted-foreground">({type})</span>
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    {t('admin', 'detailTrustSource')}
                  </label>
                  <Tooltip>
                    <span
                      className={`text-xs px-2 py-0.5 rounded cursor-help ${TRUST_CLASSES[item.trustSource] ?? 'bg-muted text-muted-foreground'}`}
                    >
                      {TRUST_KEYS[item.trustSource]
                        ? t('admin', TRUST_KEYS[item.trustSource])
                        : item.trustSource}
                    </span>
                    {TRUST_TOOLTIP_KEYS[item.trustSource] && (
                      <TooltipContent side="right" className="max-w-xs">
                        {t('admin', TRUST_TOOLTIP_KEYS[item.trustSource])}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    {t('admin', 'detailUsages')}
                  </label>
                  <span className="text-sm">
                    {actualUsageCount} {actualUsageCount === 1 ? 'fragment' : 'fragments'}
                    {isFetching && !fragmentsLoaded && (
                      <Loader2 className="inline h-3 w-3 ml-1 animate-spin" />
                    )}
                  </span>
                </div>
                {/* Category — editable for tag and entity */}
                {(type === 'tag' || type === 'entity') && (
                  <div className="col-span-2">
                    <label className="block text-xs text-muted-foreground mb-1">
                      Catégorie
                      <span className="ml-1 text-muted-foreground/60">
                        (famille du tag, ex: produit, technologie…)
                      </span>
                    </label>
                    {editingCategory ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <select
                            className="h-7 text-sm px-2 border rounded-md bg-background w-40"
                            value={categorySelect}
                            autoFocus
                            onChange={(e) => {
                              setCategorySelect(e.target.value);
                              setCategoryCustom('');
                            }}
                          >
                            <option value="">— aucune —</option>
                            {TAG_CATEGORIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                            <option value="__custom__">Autre…</option>
                          </select>
                          <Button size="sm" variant="ghost" className="h-7 px-2"
                            onClick={() => updateCategory.mutate(categoryDraft || null)}
                            disabled={updateCategory.isPending}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2"
                            onClick={() => setEditingCategory(false)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        {categorySelect === '__custom__' && (
                          <Input
                            className="h-7 text-sm w-40"
                            value={categoryCustom}
                            onChange={(e) => setCategoryCustom(e.target.value)}
                            placeholder="Saisir une catégorie…"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') updateCategory.mutate(categoryDraft || null);
                              if (e.key === 'Escape') setEditingCategory(false);
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <button
                        className="flex items-center gap-1.5 text-sm hover:text-foreground group"
                        onClick={() => {
                          const cur = currentCategory && currentCategory !== 'proposed' ? currentCategory : '';
                          if (TAG_CATEGORIES.includes(cur)) {
                            setCategorySelect(cur);
                            setCategoryCustom('');
                          } else if (cur) {
                            setCategorySelect('__custom__');
                            setCategoryCustom(cur);
                          } else {
                            setCategorySelect('');
                            setCategoryCustom('');
                          }
                          setEditingCategory(true);
                        }}
                      >
                        <span
                          className={
                            currentCategory && currentCategory !== 'proposed'
                              ? ''
                              : 'text-muted-foreground italic'
                          }
                        >
                          {currentCategory && currentCategory !== 'proposed'
                            ? currentCategory
                            : 'non définie'}
                        </span>
                        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                      </button>
                    )}
                  </div>
                )}
                {item.proposedBy && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      {t('admin', 'detailCreatedBy')}
                    </label>
                    {item.proposedBy === 'llm-auto' ? (
                      <Tooltip>
                        <span className="text-sm cursor-help underline decoration-dotted">
                          {t('admin', 'llmAutoLabel')}
                        </span>
                        <TooltipContent side="top">{t('admin', 'llmAutoTooltip')}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-sm">{item.proposedByDisplay ?? item.proposedBy}</span>
                    )}
                  </div>
                )}
                {item.createdAt && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      {t('admin', 'detailCreatedAt')}
                    </label>
                    <span className="text-sm">{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                )}
                {item.aliases && item.aliases.length > 0 && (
                  <div className="col-span-2">
                    <label className="block text-xs text-muted-foreground mb-1">Alias</label>
                    <span className="text-sm italic">{item.aliases.join(', ')}</span>
                  </div>
                )}
              </div>

              {/* Linked fragments */}
              <div className="border-t pt-4">
                <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                  {t('admin', 'linkedFragments')}
                  {fragmentsLoaded ? (
                    <span className="font-normal text-muted-foreground">
                      ({linkedFragments.length})
                    </span>
                  ) : (
                    isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {t('admin', 'linkedFragmentsHint')}
                </p>
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
                            <a
                              href={`/ui/admin/fragments?fragment=${f.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium hover:underline flex items-center gap-1 group"
                              title="Ouvrir le fragment"
                            >
                              {f.title || f.id}
                              <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-50 shrink-0" />
                            </a>
                            {f.quality && (
                              <Tooltip>
                                <Badge variant="secondary" className="text-xs shrink-0 cursor-help">
                                  {qualityKey ? t('admin', qualityKey) : f.quality}
                                </Badge>
                                {QUALITY_TOOLTIP_KEYS[f.quality] && (
                                  <TooltipContent side="top">
                                    {t('admin', QUALITY_TOOLTIP_KEYS[f.quality])}
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            )}
                          </div>
                          {f.body_excerpt && shouldShowExcerpt(f.title, f.body_excerpt) && (
                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                              {f.body_excerpt}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Rename history */}
              {renameHistory.length > 0 && (
                <div className="border-t pt-4">
                  <h3 className="font-semibold text-sm mb-2">{t('admin', 'renameHistory')}</h3>
                  <ul className="space-y-2">
                    {renameHistory.map((r: any) => (
                      <li key={r.id} className="border-l-2 border-muted pl-3 text-sm">
                        <span className="font-mono">{r.old_value}</span>
                        {' → '}
                        <span className="font-mono">{r.new_value}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Par {r.renamed_by} · {new Date(r.renamed_at).toLocaleDateString()} ·{' '}
                          {r.affected_fragments} fragments
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky footer — actions */}
        {showFooter && (
          <div className="shrink-0 border-t px-5 py-3 flex flex-wrap gap-2 bg-background">
            {isPending && (
              <Button size="sm" onClick={handleApprove} disabled={approve.isPending}>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                {t('admin', 'approve')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setRenameOpen(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {t('admin', 'rename')}
            </Button>
            {type === 'tag' && (
              <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}>
                {t('admin', 'merge')}
              </Button>
            )}
            {isPending && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReject}
                disabled={reject.isPending}
                className="text-destructive hover:text-destructive"
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                {t('admin', 'reject')}
              </Button>
            )}
          </div>
        )}

        {/* Dialogs */}
        {proposalForDialogs && renameOpen && (
          <RenameDialog
            proposal={proposalForDialogs as any}
            open
            onOpenChange={(o) => {
              setRenameOpen(o);
              if (!o) {
                qc.invalidateQueries({ queryKey: ['referential-detail', type, id] });
                onRefresh?.();
              }
            }}
          />
        )}
        {proposalForDialogs && mergeOpen && type === 'tag' && (
          <MergeDialog
            proposal={proposalForDialogs as any}
            open
            onOpenChange={(o) => {
              setMergeOpen(o);
              if (!o) {
                qc.invalidateQueries({ queryKey: ['referential-detail', type, id] });
                onRefresh?.();
              }
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
