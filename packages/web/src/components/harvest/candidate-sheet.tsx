import { useState, useEffect } from 'react';
import { Eye, Check, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrustBadge } from '@/components/admin/harvest/trust-badge';
import { MultiAutocompleteSelect } from './multi-autocomplete-select';
import { useI18n } from '@/lib/i18n';
import type { HarvestCandidate } from '@/api/types';

export interface CandidateMod {
  title?: string;
  body?: string;
  type?: string;
  domain?: string;
  lang?: string;
  tags?: string[];
}

interface Props {
  candidate: HarvestCandidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decision: 'pending' | 'accepted' | 'rejected';
  onAccept: (mod?: CandidateMod) => void;
  onReject: () => void;
}

export function CandidateSheet({
  candidate,
  open,
  onOpenChange,
  decision,
  onAccept,
  onReject,
}: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('');
  const [domain, setDomain] = useState('');
  const [lang, setLang] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (candidate) {
      setTitle(candidate.title ?? '');
      setBody(candidate.body ?? '');
      setType(candidate.type ?? '');
      setDomain(candidate.domain ?? '');
      setLang(candidate.lang ?? '');
      setTags(candidate.tags ?? []);
    }
  }, [candidate?.id]);

  const { t } = useI18n();

  if (!candidate) return null;

  const candidateTags = candidate.tags ?? [];
  const isModified =
    title !== candidate.title ||
    body !== candidate.body ||
    type !== candidate.type ||
    domain !== candidate.domain ||
    lang !== candidate.lang ||
    tags.length !== candidateTags.length ||
    tags.some((t, i) => t !== candidateTags[i]);

  const buildMod = (): CandidateMod | undefined => {
    if (!isModified) return undefined;
    return { title, body, type, domain, lang, tags };
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto flex flex-col">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4" />
            {t('harvest', 'candidateDetail')}
          </SheetTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <TrustBadge trustSourcesJson={candidate.trust_sources_json} />
            <Badge variant="outline" className="text-xs">
              {(candidate.confidence * 100).toFixed(0)}%
            </Badge>
            {candidate.duplicate_of && (
              <Badge variant="destructive" className="text-xs">
                {t('harvest', 'duplicatePotential')}
              </Badge>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <input
                className="w-full text-sm border rounded px-2 py-1.5 bg-background"
                value={type}
                onChange={(e) => setType(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Domaine</label>
              <input
                className="w-full text-sm border rounded px-2 py-1.5 bg-background"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Langue</label>
              <input
                className="w-full text-sm border rounded px-2 py-1.5 bg-background"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Titre</label>
            <input
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Tags</label>
            <MultiAutocompleteSelect
              kind="tag"
              values={tags}
              onChange={setTags}
              placeholder="Ajouter un tag…"
              allowCreate
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Corps
              {isModified && <span className="ml-2 text-amber-600">modifié</span>}
            </label>
            <textarea
              className="w-full text-sm border rounded px-2 py-1.5 bg-background font-mono leading-relaxed resize-none"
              rows={18}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <SheetFooter className="mt-4 flex gap-2 justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onReject();
              onOpenChange(false);
            }}
            className="text-destructive hover:text-destructive"
            disabled={decision === 'rejected'}
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Rejeter
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onAccept(buildMod());
              onOpenChange(false);
            }}
            disabled={decision === 'accepted' && !isModified}
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            {isModified ? 'Enregistrer et accepter' : 'Accepter'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
