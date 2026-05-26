import { useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { Edit, Archive, RotateCcw } from 'lucide-react';
import { RenameModal } from './rename-modal';
import { ConfirmModal } from './confirm-modal';
import { ReferentialItemSheet, type SheetInitialItem } from './referential-item-sheet';

type ReferentialType = 'domain' | 'tag' | 'entity' | 'type' | 'function';

const CATEGORY_KEYS: Record<string, 'catConcept' | 'catMode' | 'catIndustry' | 'catOther' | 'catProposed'> = {
  concept: 'catConcept',
  mode: 'catMode',
  industry: 'catIndustry',
  other: 'catOther',
  proposed: 'catProposed',
};

type ReferentialStatus = 'active' | 'pending' | 'rejected' | 'archived';

interface ReferentialItem {
  id: string | number;
  label: string;
  category?: string;
  status: ReferentialStatus;
  trustSource: string;
  usageCount: number;
  aliases?: string[];
  createdAt?: string;
  proposedBy?: string;
  proposedByRole?: string | null;
  proposedByDisplay?: string | null;
}

interface Props {
  type: ReferentialType;
  item: ReferentialItem;
  onChange: () => void;
}

const ROLE_KEYS: Record<string, 'roleAdmin' | 'roleContributor' | 'roleExpert' | 'roleReader' | 'roleManager'> = {
  admin: 'roleAdmin',
  contributor: 'roleContributor',
  expert: 'roleExpert',
  reader: 'roleReader',
  manager: 'roleManager',
};

function roleKey(role: string): 'roleAdmin' | 'roleContributor' | 'roleExpert' | 'roleReader' | 'roleManager' {
  return ROLE_KEYS[role] ?? 'roleReader';
}

const TRUST_CLASSES: Record<string, string> = {
  'human-direct': 'bg-green-100 text-green-800',
  'llm-confirmed': 'bg-blue-100 text-blue-800',
  'llm-inferred': 'bg-amber-100 text-amber-800',
  'llm-deviation': 'bg-red-100 text-red-800',
};

export function ReferentialItemCard({ type, item, onChange }: Props) {
  const [showRename, setShowRename] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const itemKey = `${type}/${item.id}`;
  const [sheetOpen, setSheetOpen] = useState(() => searchParams.get('item') === itemKey);
  const lastClosedRef = useRef(0);
  const { t } = useI18n();
  const isHidden = item.status === 'archived' || item.status === 'rejected';

  const trustLabelMap: Record<string, string> = {
    'human-direct': t('admin', 'trustHuman'),
    'llm-confirmed': t('admin', 'trustLlmConfirmed'),
    'llm-inferred': t('admin', 'trustLlmInferred'),
    'llm-deviation': t('admin', 'trustLlmDeviation'),
  };
  const trustTooltipMap: Record<string, string> = {
    'human-direct': t('admin', 'trustTooltipHuman'),
    'llm-confirmed': t('admin', 'trustTooltipConfirmed'),
    'llm-inferred': t('admin', 'trustTooltipInferred'),
    'llm-deviation': t('admin', 'trustTooltipDeviation'),
  };

  const handleArchive = async () => {
    await apiRequest('POST', `/v1/admin/referential/${type}/${item.id}/archive`);
    setShowArchive(false);
    onChange();
  };

  const handleRestore = async () => {
    await apiRequest('POST', `/v1/admin/referential/${type}/${item.id}/restore`);
    onChange();
  };

  function openSheet() {
    if (Date.now() - lastClosedRef.current < 150) return;
    setSheetOpen(true);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('item', itemKey); return next; }, { replace: true });
  }

  function handleSheetOpenChange(open: boolean) {
    if (!open) {
      lastClosedRef.current = Date.now();
      setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete('item'); return next; }, { replace: true });
    }
    setSheetOpen(open);
  }

  return (
    <Card className={`p-4 cursor-pointer hover:bg-accent/40 transition-colors ${isHidden ? 'opacity-60' : ''}`}>
      <div
        className="flex-1 min-w-0"
        onClick={openSheet}
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <code className="text-sm font-medium px-1.5 py-0.5 bg-muted rounded">{item.label}</code>
          {item.category && (
            <Badge variant="secondary">
              {CATEGORY_KEYS[item.category] ? t('admin', CATEGORY_KEYS[item.category]) : item.category}
            </Badge>
          )}
          {item.usageCount > 0 && (
            <Badge variant="secondary">
              {item.usageCount} {item.usageCount === 1 ? 'fragment' : 'fragments'}
            </Badge>
          )}
          <Tooltip>
            <span className={`text-xs px-2 py-0.5 rounded cursor-help ${TRUST_CLASSES[item.trustSource] ?? 'bg-muted text-muted-foreground'}`}>
              {trustLabelMap[item.trustSource] ?? item.trustSource}
            </span>
            {trustTooltipMap[item.trustSource] && (
              <TooltipContent side="top">{trustTooltipMap[item.trustSource]}</TooltipContent>
            )}
          </Tooltip>
          {item.status === 'archived' && (
            <Badge variant="secondary" className="bg-gray-100 text-gray-700">{t('admin', 'statusArchived')}</Badge>
          )}
          {item.status === 'rejected' && (
            <Badge variant="destructive">{t('admin', 'statusRejected')}</Badge>
          )}
          {item.status === 'pending' && (
            <Badge className="bg-amber-100 text-amber-700">{t('admin', 'statusPending')}</Badge>
          )}
        </div>
        {(item.createdAt || item.proposedBy) && (
          <p className="text-xs text-muted-foreground mb-2">
            {item.proposedBy && (
              <span>
                {t('admin', 'proposedByLabel')}{' '}
                {item.proposedByDisplay ?? item.proposedBy}
                {item.proposedByRole && ` (${t('admin', roleKey(item.proposedByRole))})`}
                {item.createdAt ? ' · ' : ''}
              </span>
            )}
            {item.createdAt && new Date(item.createdAt).toLocaleDateString()}
          </p>
        )}
        {item.aliases && item.aliases.length > 0 && (
          <p className="text-xs text-muted-foreground italic mb-2">
            Alias : {item.aliases.join(', ')}
          </p>
        )}
      </div>

      <div className="flex gap-2 flex-wrap mt-3" onClick={(e) => e.stopPropagation()}>
        {!isHidden ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setShowRename(true)}>
              <Edit className="h-3.5 w-3.5 mr-1.5" />
              {t('admin', 'rename')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowArchive(true)} className="text-amber-700 hover:text-amber-700">
              <Archive className="h-3.5 w-3.5 mr-1.5" />
              {t('admin', 'archiveItem')}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={handleRestore} className="text-green-700 hover:text-green-700">
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            {t('admin', 'restoreItem')}
          </Button>
        )}
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        {showRename && (
          <RenameModal type={type} item={item} onClose={() => setShowRename(false)} onSuccess={() => { setShowRename(false); onChange(); }} />
        )}
        {showArchive && (
          <ConfirmModal
            title={t('admin', 'archiveConfirmTitle')}
            message={`"${item.label}" sera archivé${item.usageCount > 0 ? ` — ${item.usageCount} fragment${item.usageCount === 1 ? '' : 's'} l'utilisent` : ''}.`}
            confirmLabel={t('admin', 'archiveItem')}
            onConfirm={handleArchive}
            onClose={() => setShowArchive(false)}
          />
        )}
      </div>
      <ReferentialItemSheet
        type={type}
        id={item.id}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        initialItem={item as SheetInitialItem}
      />
    </Card>
  );
}
