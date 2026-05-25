import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Eye, Pencil, X } from 'lucide-react';

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
  onChange: (edits: MetaEdits) => void;
}

export function FragmentMetaEditor({ edits, types, domains, onChange }: Props) {
  const [tagInput, setTagInput] = useState('');
  const [editingBody, setEditingBody] = useState(false);

  const set = (patch: Partial<MetaEdits>) => onChange({ ...edits, ...patch });

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag || edits.tags.includes(tag)) return;
    set({ tags: [...edits.tags, tag] });
    setTagInput('');
  };

  const removeTag = (tag: string) => set({ tags: edits.tags.filter((t) => t !== tag) });

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
              {tag}
              <button onClick={() => removeTag(tag)} className="ml-0.5 hover:text-destructive">
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
        <Input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(tagInput);
            }
          }}
          placeholder="Ajouter un tag (Entrée)"
          className="h-7 text-xs"
        />
      </div>

      {/* Body */}
      <div className="space-y-1">
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
          <div className="text-sm bg-muted/50 rounded-md p-3 overflow-y-auto max-h-[35vh] prose prose-sm max-w-none dark:prose-invert prose-table:text-xs prose-td:p-1 prose-th:p-1">
            <ReactMarkdown>{edits.body}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
