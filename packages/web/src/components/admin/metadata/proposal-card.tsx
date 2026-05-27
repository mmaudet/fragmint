import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, X, Edit, Combine, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import { useApproveProposal, useRejectProposal } from '@/api/hooks/use-metadata-proposals';
import { useI18n } from '@/lib/i18n';
import { RenameDialog } from './rename-dialog';
import { MergeDialog } from './merge-dialog';
import { ConvertToEntityDialog } from './convert-to-entity-dialog';
import { ReferentialItemSheet } from '@/components/admin/referential-item-sheet';
import type { MetadataProposal } from '@/types/admin-metadata';
import type { TrustSource } from '@/types/trust-source';

interface Props {
  proposal: MetadataProposal;
  selected: boolean;
  onToggle: () => void;
}

const TRUST_CLASSES: Record<TrustSource, string> = {
  'human-direct': 'bg-green-100 text-green-800',
  'llm-confirmed': 'bg-blue-100 text-blue-800',
  'llm-deviation': 'bg-amber-100 text-amber-800',
  'llm-inferred': 'bg-sky-100 text-sky-800',
};

const ROLE_KEYS: Record<
  string,
  'roleAdmin' | 'roleContributor' | 'roleExpert' | 'roleReader' | 'roleManager'
> = {
  admin: 'roleAdmin',
  contributor: 'roleContributor',
  expert: 'roleExpert',
  reader: 'roleReader',
  manager: 'roleManager',
};

const FLAG_LABEL_KEYS: Record<string, 'flagLowUsage' | 'flagPossiblyEntity'> = {
  'Low usage': 'flagLowUsage',
  'Possibly entity': 'flagPossiblyEntity',
};

export function ProposalCard({ proposal, selected, onToggle }: Props) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const approve = useApproveProposal();
  const reject = useRejectProposal();
  const { t } = useI18n();

  return (
    <Card className="p-4">
      <div className="flex gap-3">
        <div className="mt-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            className="h-5 w-5 border-2 border-muted-foreground data-[state=checked]:border-primary"
          />
        </div>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSheetOpen(true)}>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <code className="text-sm font-medium px-1.5 py-0.5 bg-muted rounded">
              {proposal.name}
            </code>
            {proposal.usage_count > 0 && (
              <Badge variant="secondary">
                {proposal.entity_type && <span className="mr-1">{proposal.entity_type} ·</span>}
                {proposal.usage_count} {proposal.usage_count === 1 ? 'fragment' : 'fragments'}
              </Badge>
            )}
            <TrustSourceBadge source={proposal.trust_source} t={t} />
            {proposal.flags.map((flag, i) => (
              <Badge
                key={i}
                variant={flag.type === 'warning' ? 'destructive' : 'info'}
                className="text-xs"
              >
                {flag.type === 'warning' ? (
                  <AlertTriangle className="h-3 w-3 mr-1" />
                ) : (
                  <Info className="h-3 w-3 mr-1" />
                )}
                {FLAG_LABEL_KEYS[flag.label] ? t('admin', FLAG_LABEL_KEYS[flag.label]) : flag.label}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {t('admin', 'proposedByLabel')} {proposal.proposed_by_display ?? proposal.proposed_by}
            {proposal.proposed_by_role &&
              ` (${t('admin', ROLE_KEYS[proposal.proposed_by_role] ?? 'roleReader')})`}
            {' · '}
            {new Date(proposal.created_at).toLocaleDateString()}
          </p>
          {proposal.preview && (
            <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
              <span className="font-medium not-italic">{t('admin', 'previewExampleLabel')}</span>{' '}
              <span className="italic">«&nbsp;{proposal.preview}&nbsp;»</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap mt-3 ml-8" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          onClick={() => approve.mutate({ id: proposal.id, kind: proposal.kind })}
          disabled={approve.isPending}
        >
          <Check className="h-3.5 w-3.5 mr-1.5" />
          {t('admin', 'approve')}
        </Button>
        {proposal.flags.some((f) => f.label === 'Possibly entity') && proposal.kind === 'tag' && (
          <Button size="sm" variant="outline" onClick={() => setConvertOpen(true)}>
            <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
            {t('admin', 'convertToEntity')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setRenameOpen(true)}>
          <Edit className="h-3.5 w-3.5 mr-1.5" />
          {t('admin', 'rename')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}>
          <Combine className="h-3.5 w-3.5 mr-1.5" />
          {t('admin', 'merge')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => reject.mutate({ id: proposal.id, kind: proposal.kind })}
          disabled={reject.isPending}
          className="text-destructive hover:text-destructive"
        >
          <X className="h-3.5 w-3.5 mr-1.5" />
          {t('admin', 'reject')}
        </Button>
      </div>
      {renameOpen && <RenameDialog proposal={proposal} open onOpenChange={setRenameOpen} />}
      {mergeOpen && <MergeDialog proposal={proposal} open onOpenChange={setMergeOpen} />}
      {convertOpen && (
        <ConvertToEntityDialog proposal={proposal} open onOpenChange={setConvertOpen} />
      )}
      <ReferentialItemSheet
        type={proposal.kind}
        id={proposal.id}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </Card>
  );
}

function TrustSourceBadge({
  source,
  t,
}: {
  source?: TrustSource;
  t: (s: 'admin', k: any) => string;
}) {
  if (!source) return null;

  const labelMap: Record<TrustSource, string> = {
    'human-direct': t('admin', 'trustHuman'),
    'llm-confirmed': t('admin', 'trustLlmConfirmed'),
    'llm-deviation': t('admin', 'trustLlmDeviation'),
    'llm-inferred': t('admin', 'trustLlmInferred'),
  };

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded ${TRUST_CLASSES[source] ?? 'bg-muted text-muted-foreground'}`}
    >
      {labelMap[source] ?? source}
    </span>
  );
}
