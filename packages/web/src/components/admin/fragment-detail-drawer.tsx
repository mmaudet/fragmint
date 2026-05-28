// packages/web/src/components/admin/fragment-detail-drawer.tsx
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle2, Archive, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from './status-badge';
import { OriginBadge } from './origin-badge';
import { apiRequest } from '@/api/client';
import { Sheet, SheetContent, SheetClose, SheetTitle } from '@/components/ui/sheet';
import { useReferenceLookup } from '@/api/hooks/use-reference-lookup';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { FragmentMetaEditor, type MetaEdits } from '@/components/fragment-meta-editor';
import { useDomains, useTypes, useTags } from '@/api/hooks/use-taxonomy';

interface FragmentEntity {
  id: number;
  canonicalName: string;
  type: string;
}

interface FragmentDetail {
  id: string;
  title: string | null;
  body: string;
  body_excerpt: string | null;
  domain: string;
  type: string;
  lang: string;
  quality: string;
  origin: string;
  origin_source: string | null;
  origin_page: number | null;
  harvest_confidence: number | null;
  tags: string[] | null;
  uses: number;
  author: string;
  created_at: string;
  updated_at: string;
  collection_slug: string | null;
  superseded_by: string | null;
  supersedes: string | null;
  git_hash: string | null;
  entities: FragmentEntity[];
  frontmatter?: {
    reviewed_by?: string | null;
    approved_by?: string | null;
    [key: string]: unknown;
  };
  harvest_near_dup?: {
    fragment_id: string;
    score: number | null;
    method: string | null;
  } | null;
}

interface Props {
  fragmentId: string;
  onClose: () => void;
  onUpdate: () => void;
}

/** Inline entity search picker that exposes the full {id, name, type} on selection. */
function EntityPicker({ onAdd }: { onAdd: (entity: FragmentEntity) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debouncedQ = useDebouncedValue(query, 250);
  const { data = [] } = useReferenceLookup('entity', debouncedQ);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (item: (typeof data)[number]) => {
    onAdd({ id: parseInt(item.slug, 10), canonicalName: item.label, type: item.type ?? '' });
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Rechercher une entité validée…"
        className="w-full px-2 py-1 border rounded text-sm bg-background"
      />
      {open && data.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-40 overflow-y-auto">
          {data.map((item) => (
            <button
              key={item.slug}
              type="button"
              onMouseDown={() => select(item)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center justify-between"
            >
              <span>{item.label}</span>
              {item.type && <span className="text-xs text-muted-foreground ml-2">{item.type}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY_EDITS: MetaEdits = { type: '', domain: '', lang: '', tags: [], body: '' };

export function FragmentDetailDrawer({ fragmentId, onClose, onUpdate }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<MetaEdits>(EMPTY_EDITS);
  const [editEntities, setEditEntities] = useState<FragmentEntity[]>([]);
  const [open, setOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Taxonomy data for dropdowns / autocomplete
  const { data: domainsData } = useDomains();
  const { data: typesData } = useTypes();
  const { data: tagsData } = useTags();
  const domains = (domainsData ?? []).map((d) => d.slug);
  const types = (typesData ?? []).map((t) => t.slug);
  const availableTags = (tagsData ?? []).map((t) => t.slug);

  const {
    data: frag,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['fragment-detail', fragmentId],
    queryFn: () => apiRequest<FragmentDetail>('GET', `/v1/fragments/${fragmentId}`),
  });

  useEffect(() => {
    if (frag) {
      setForm({
        type: frag.type,
        domain: frag.domain,
        lang: frag.lang,
        tags: frag.tags ?? [],
        body: frag.body ?? frag.body_excerpt ?? '',
      });
    }
  }, [frag]);

  useEffect(() => {
    setEditing(false);
    setForm(EMPTY_EDITS);
    setEditEntities([]);
    setConfirmDelete(false);
  }, [fragmentId]);

  const startEditing = () => {
    setEditEntities(frag?.entities ?? []);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditEntities([]);
  };

  const addEntity = (entity: FragmentEntity) => {
    if (editEntities.some((e) => e.id === entity.id)) return;
    setEditEntities((prev) => [...prev, entity]);
  };

  const removeEntity = (id: number) => setEditEntities((prev) => prev.filter((e) => e.id !== id));

  const updateMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        apiRequest('PUT', `/v1/fragments/${fragmentId}`, {
          domain: form.domain,
          type: form.type,
          lang: form.lang,
          tags: form.tags,
          body: form.body || undefined,
        }),
        apiRequest('PUT', `/v1/fragments/${fragmentId}/entities`, {
          entity_ids: editEntities.map((e) => e.id),
        }),
      ]);
    },
    onSuccess: () => {
      setEditing(false);
      setEditEntities([]);
      queryClient.invalidateQueries({ queryKey: ['fragment-detail', fragmentId] });
      onUpdate();
      toast.success('Fragment mis à jour');
    },
    onError: (e: any) => toast.error(`Erreur : ${e.message}`),
  });

  const approveMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/v1/fragments/${fragmentId}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragment-detail', fragmentId] });
      onUpdate();
      toast.success('Fragment approuvé');
    },
    onError: (e: any) => toast.error(`Erreur : ${e.message}`),
  });

  const handleApprove = async () => {
    if (editing) {
      try {
        await updateMutation.mutateAsync();
      } catch {
        return; // updateMutation.onError already shows a toast
      }
    }
    approveMutation.mutate();
  };

  const deprecateMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/v1/fragments/${fragmentId}/deprecate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fragment-detail', fragmentId] });
      onUpdate();
      toast.success('Fragment archivé');
    },
    onError: (e: any) => toast.error(`Erreur : ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', `/v1/fragments/${fragmentId}`),
    onSuccess: () => {
      handleOpenChange(false);
      onUpdate();
      toast.success('Fragment supprimé');
    },
    onError: (e: any) => toast.error(`Erreur : ${e.message}`),
  });

  function handleOpenChange(o: boolean) {
    if (!o) {
      setOpen(false);
      setTimeout(onClose, 310);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-[640px] sm:max-w-[640px] gap-0 p-0 flex flex-col"
      >
        <SheetTitle className="sr-only">Détail du fragment</SheetTitle>

        {/* Header */}
        <div className="shrink-0 bg-background border-b px-5 py-3 flex items-center justify-between z-10">
          <SheetClose asChild>
            <button className="text-sm hover:underline text-muted-foreground">← Fermer</button>
          </SheetClose>
          {frag && (
            <div className="flex items-center gap-2">
              <StatusBadge quality={frag.quality} />
              {!editing ? (
                <button
                  onClick={startEditing}
                  className="px-3 py-1 text-sm border rounded hover:bg-muted"
                >
                  Éditer
                </button>
              ) : (
                <>
                  <button
                    onClick={cancelEditing}
                    className="px-3 py-1 text-sm border rounded hover:bg-muted"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={() => updateMutation.mutate()}
                    disabled={updateMutation.isPending}
                    className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
                  >
                    {updateMutation.isPending ? '…' : 'Enregistrer'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {isLoading && <p className="text-muted-foreground text-sm">Chargement…</p>}
          {isError && <p className="text-sm text-destructive">Erreur de chargement du fragment.</p>}

          {frag && (
            <>
              <h2 className="text-lg font-semibold">
                {frag.title || <em className="text-muted-foreground font-normal">Sans titre</em>}
              </h2>

              {editing ? (
                /* ── Edit mode: unified meta + body editor ── */
                <FragmentMetaEditor
                  edits={form}
                  onChange={setForm}
                  types={types}
                  domains={domains}
                  availableTags={availableTags}
                />
              ) : (
                /* ── Read mode: metadata grid + tags + body ── */
                <>
                  {/* Core metadata grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Domaine</label>
                      <code className="text-sm">{frag.domain}</code>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Type</label>
                      <code className="text-sm">{frag.type}</code>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Langue</label>
                      <span className="text-sm">{frag.lang}</span>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">
                        Utilisations
                      </label>
                      <span className="text-sm">{frag.uses}</span>
                    </div>
                    {frag.collection_slug && (
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">
                          Collection
                        </label>
                        <code className="text-sm">{frag.collection_slug}</code>
                      </div>
                    )}
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Tags</label>
                    <div className="flex flex-wrap gap-1">
                      {(frag.tags ?? []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">Aucun tag</span>
                      ) : (
                        (frag.tags ?? []).map((t) => (
                          <span
                            key={t}
                            className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded dark:bg-blue-900/30 dark:text-blue-300"
                          >
                            #{t}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Entities — shown in both modes */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Entités</label>
                {editing ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1 min-h-[1.5rem]">
                      {editEntities.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Aucune entité</span>
                      ) : (
                        editEntities.map((e) => (
                          <span
                            key={e.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded dark:bg-purple-900/30 dark:text-purple-300"
                          >
                            {e.canonicalName}
                            {e.type && <span className="opacity-60">({e.type})</span>}
                            <button
                              type="button"
                              onClick={() => removeEntity(e.id)}
                              className="ml-0.5 hover:text-red-500"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <EntityPicker onAdd={addEntity} />
                    <p className="text-xs text-muted-foreground">
                      Seules les entités validées dans le référentiel sont proposées.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {(frag.entities ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">Aucune entité</span>
                    ) : (
                      frag.entities.map((e) => (
                        <span
                          key={e.id}
                          className="px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded dark:bg-purple-900/30 dark:text-purple-300"
                        >
                          {e.canonicalName}
                          {e.type && <span className="ml-1 opacity-60">({e.type})</span>}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Origin */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Origine</label>
                  <OriginBadge origin={frag.origin} />
                </div>
                {frag.origin_source && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Source</label>
                    <span className="text-xs truncate block" title={frag.origin_source}>
                      {frag.origin_source}
                    </span>
                    {frag.origin_page != null && (
                      <span className="text-xs text-muted-foreground">p.{frag.origin_page}</span>
                    )}
                  </div>
                )}
                {frag.harvest_confidence != null && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      Confiance LLM
                    </label>
                    <span className="text-sm">{Math.round(frag.harvest_confidence * 100)}%</span>
                  </div>
                )}
              </div>

              {/* Supersedure links */}
              {(frag.superseded_by || frag.supersedes) && (
                <div className="border-t pt-4 space-y-2">
                  {frag.superseded_by && (
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">
                        Remplacé par
                      </label>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {frag.superseded_by}
                      </code>
                    </div>
                  )}
                  {frag.supersedes && (
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Remplace</label>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {frag.supersedes}
                      </code>
                    </div>
                  )}
                </div>
              )}

              {/* Body — read-only view only (editing uses FragmentMetaEditor above) */}
              {!editing && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Contenu</label>
                  <pre className="text-xs whitespace-pre-wrap font-sans bg-muted/40 rounded p-3 max-h-80 overflow-y-auto border">
                    {frag.body ?? frag.body_excerpt ?? '(vide)'}
                  </pre>
                </div>
              )}

              {/* System info */}
              <div className="border-t pt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="col-span-2">
                  <strong>ID</strong> : <code className="text-xs">{frag.id}</code>
                </div>
                <div>
                  <strong>Auteur</strong> : {frag.author}
                </div>
                {frag.frontmatter?.reviewed_by && (
                  <div>
                    <strong>Reviewé par</strong> : {String(frag.frontmatter.reviewed_by)}
                  </div>
                )}
                {frag.frontmatter?.approved_by && (
                  <div>
                    <strong>Approuvé par</strong> : {String(frag.frontmatter.approved_by)}
                  </div>
                )}
                <div>
                  <strong>Créé</strong> : {new Date(frag.created_at).toLocaleString('fr-FR')}
                </div>
                <div>
                  <strong>Modifié</strong> : {new Date(frag.updated_at).toLocaleString('fr-FR')}
                </div>
                {frag.git_hash && (
                  <div className="col-span-2">
                    <strong>Commit</strong> : <code className="text-xs">{frag.git_hash}</code>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Actions footer — sticky at bottom */}
        {frag && frag.quality !== 'deprecated' && (
          <div className="shrink-0 border-t px-5 py-3 flex flex-wrap gap-2 bg-background">
            {frag.quality === 'reviewed' && (
              <button
                onClick={handleApprove}
                disabled={approveMutation.isPending || updateMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {approveMutation.isPending ? '…' : 'Approuver'}
              </button>
            )}
            <button
              onClick={() => deprecateMutation.mutate()}
              disabled={deprecateMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded hover:bg-muted disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" />
              {deprecateMutation.isPending ? '…' : 'Archiver'}
            </button>
            <div className="ml-auto">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Confirmer ?</span>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-1 text-xs border rounded hover:bg-muted"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:bg-destructive/50 disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? '…' : 'Supprimer'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-destructive text-destructive rounded hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer
                </button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
