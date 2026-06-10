import { useState, useRef } from 'react';

const TAG_PREFIXES = [
  { value: 'client', label: 'Client' },
  { value: 'produit', label: 'Produit' },
  { value: 'tech', label: 'Technologie' },
  { value: 'partner', label: 'Partenaire' },
  { value: 'cert', label: 'Certification' },
  { value: 'reg', label: 'Règlementation' },
];
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Eye, Pencil, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tagDisplayLabel } from '@/lib/tag-display';

function levenshteinSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  const rows = shorter.length + 1;
  const cols = longer.length + 1;
  const mat: number[][] = [];
  for (let j = 0; j < rows; j++) {
    mat[j] = [];
    for (let i = 0; i < cols; i++) {
      mat[j][i] = j === 0 ? i : i === 0 ? j : 0;
    }
  }
  for (let j = 1; j <= shorter.length; j++)
    for (let i = 1; i <= longer.length; i++)
      mat[j][i] =
        longer[i - 1] === shorter[j - 1]
          ? mat[j - 1][i - 1]
          : Math.min(mat[j][i - 1] + 1, mat[j - 1][i] + 1, mat[j - 1][i - 1] + 1);
  return (longer.length - mat[shorter.length][longer.length]) / longer.length;
}

function findSimilarTag(normalized: string, availableTags: string[]): string | null {
  if (normalized.length < 3) return null;
  for (const tag of availableTags) {
    if (tag === normalized) continue;
    if (levenshteinSimilarity(normalized, tag) > 0.78) return tag;
  }
  return null;
}

const LANGS = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pt', 'ar'];

export interface MetaEdits {
  type: string;
  domain: string;
  lang: string;
  tags: string[];
  body: string;
}

interface Props {
  edits: MetaEdits;
  types: string[];
  domains: string[];
  availableTags?: string[];
  onChange: (edits: MetaEdits) => void;
  hideBody?: boolean;
}

export function FragmentMetaEditor({ edits, types, domains, availableTags, onChange, hideBody }: Props) {
  const [tagInput, setTagInput] = useState('');
  const [pendingTag, setPendingTag] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [similarTag, setSimilarTag] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<MetaEdits>) => onChange({ ...edits, ...patch });

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
    setTagInput('');
    setShowSuggestions(false);
    setActiveSuggestion(0);
    setSimilarTag(null);
    if (!tag) return;
    // If tag already has a prefix or is being selected from suggestions, add directly
    if (tag.includes(':') || availableTags?.includes(tag)) {
      if (!edits.tags.includes(tag)) set({ tags: [...edits.tags, tag] });
    } else {
      setPendingTag(tag);
    }
  };

  const confirmPending = (prefix: string | null) => {
    if (!pendingTag) return;
    const final = prefix ? `${prefix}:${pendingTag}` : pendingTag;
    if (!edits.tags.includes(final)) set({ tags: [...edits.tags, final] });
    setPendingTag(null);
    inputRef.current?.focus();
  };

  const handleTagInputChange = (value: string) => {
    setTagInput(value);
    setActiveSuggestion(0);
    setShowSuggestions(true);
    if (availableTags && value.trim().length >= 3) {
      const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
      setSimilarTag(findSimilarTag(normalized, availableTags));
    } else {
      setSimilarTag(null);
    }
  };

  const removeTag = (tag: string) => set({ tags: edits.tags.filter((t) => t !== tag) });

  const filteredSuggestions =
    availableTags && tagInput.length > 0
      ? availableTags
          .filter(
            (t) => t.toLowerCase().includes(tagInput.toLowerCase()) && !edits.tags.includes(t),
          )
          .slice(0, 8)
      : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Type / Domain / Lang */}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Type</label>
          <Select value={edits.type} onValueChange={(v) => set({ type: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...(edits.type ? [edits.type] : []), ...types])].map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Domaine</label>
          <Select value={edits.domain} onValueChange={(v) => set({ domain: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...(edits.domain ? [edits.domain] : []), ...domains])].map((d) => (
                <SelectItem key={d} value={d} className="text-xs">
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Langue</label>
          <Select value={edits.lang} onValueChange={(v) => set({ lang: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGS.map((l) => (
                <SelectItem key={l} value={l} className="text-xs">
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Tags</label>
        <div className="flex flex-wrap gap-1">
          {edits.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1 pr-1">
              {tagDisplayLabel(tag)}
              <button onClick={() => removeTag(tag)} className="ml-0.5 hover:text-destructive">
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="relative">
          <Input
            ref={inputRef}
            value={tagInput}
            onChange={(e) => handleTagInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const target =
                  filteredSuggestions.length > 0 && showSuggestions
                    ? (filteredSuggestions[activeSuggestion] ?? tagInput)
                    : tagInput;
                addTag(target);
              } else if (e.key === 'Escape') {
                setTagInput('');
                setShowSuggestions(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveSuggestion((i) => Math.min(i + 1, filteredSuggestions.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveSuggestion((i) => Math.max(i - 1, 0));
              }
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              // Commit partial input when focus leaves (e.g. user clicks a button)
              // Small delay so mousedown on suggestion fires first
              setTimeout(() => {
                setShowSuggestions(false);
                if (tagInput.trim()) addTag(tagInput);
              }, 150);
            }}
            placeholder="Ajouter un tag (Entrée)"
            className="h-7 text-xs"
          />
          {similarTag && (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Tag similaire existant&nbsp;: <code className="font-mono">{similarTag}</code> —
              doublon possible ?
            </p>
          )}
          {showSuggestions && filteredSuggestions.length > 0 && (
            <ul className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-popover border rounded-md shadow-md overflow-hidden">
              {filteredSuggestions.map((tag, i) => (
                <li
                  key={tag}
                  className={cn(
                    'px-3 py-1.5 text-xs cursor-pointer hover:bg-accent',
                    i === activeSuggestion && 'bg-accent',
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent input blur before click
                    addTag(tag);
                    inputRef.current?.focus();
                  }}
                >
                  {tagDisplayLabel(tag)}
                </li>
              ))}
            </ul>
          )}
        </div>
        {pendingTag && (
          <div className="mt-1 p-2 border rounded-md bg-muted/40 space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Catégorie pour <code className="font-medium text-foreground">{pendingTag}</code> ?
            </p>
            <div className="flex flex-wrap gap-1">
              {TAG_PREFIXES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50"
                  onMouseDown={() => confirmPending(p.value)}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80"
                onMouseDown={() => confirmPending(null)}
              >
                Sans catégorie
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      {!hideBody && <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Corps</label>
          <button
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setEditingBody((v) => !v)}
          >
            {editingBody ? (
              <>
                <Eye className="h-3 w-3" /> Aperçu
              </>
            ) : (
              <>
                <Pencil className="h-3 w-3" /> Éditer
              </>
            )}
          </button>
        </div>
        {editingBody ? (
          <textarea
            className="w-full min-h-[35vh] text-xs font-mono bg-muted/50 rounded-md p-3 border border-input resize-y focus:outline-none focus:ring-1 focus:ring-ring"
            value={edits.body}
            onChange={(e) => set({ body: e.target.value })}
          />
        ) : (
          <div className="text-sm bg-muted/50 rounded-md p-3 overflow-y-auto max-h-[35vh] prose prose-sm max-w-none dark:prose-invert prose-headings:text-sm prose-headings:font-semibold prose-table:text-xs prose-td:p-1 prose-th:p-1">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                a: ({ href, children }) =>
                  href?.startsWith('#') ? (
                    <span>{children}</span>
                  ) : (
                    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                  ),
              }}
            >{edits.body}</ReactMarkdown>
          </div>
        )}
      </div>}
    </div>
  );
}
