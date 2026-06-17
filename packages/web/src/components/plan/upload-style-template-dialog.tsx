import { useState } from 'react';
import { useUploadStyleTemplate } from '@/api/hooks/use-style-templates';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';
import { CheckCircle, AlertTriangle } from 'lucide-react';

type Warning = { style: string; issue: string };

export function UploadStyleTemplateDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUploaded: (id: string, outputFormat: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [warnings, setWarnings] = useState<Warning[] | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const upload = useUploadStyleTemplate();
  const { t } = useI18n();

  async function handleUpload() {
    if (!file || !name) {
      toast.error('Sélectionnez un fichier et saisissez un nom');
      return;
    }
    const created = await upload.mutateAsync({ file, name, description: description || undefined });
    setUploadedId(created.id);
    setWarnings(created.warnings ?? []);
  }

  function handleConfirm() {
    if (!uploadedId || !file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'docx';
    onUploaded(uploadedId, ext === 'pptx' ? 'pptx' : 'docx');
    handleClose();
  }

  function handleClose() {
    onOpenChange(false);
    setFile(null);
    setName('');
    setDescription('');
    setWarnings(null);
    setUploadedId(null);
  }

  const showResult = uploadedId !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planGeneration', 'uploadStyleTemplate')}</DialogTitle>
        </DialogHeader>

        {!showResult ? (
          <>
            <div className="space-y-3">
              <Input
                type="file"
                accept=".docx,.pptx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} />
              <Input
                placeholder="Description (optionnel)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button onClick={handleUpload} disabled={upload.isPending}>
                {upload.isPending ? 'Import en cours…' : 'Importer'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              {warnings && warnings.length === 0 ? (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="h-4 w-4" />
                  Tous les styles requis sont définis. Le modèle est prêt à l'emploi.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-amber-600 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    {warnings?.length} style{(warnings?.length ?? 0) > 1 ? 's' : ''} incomplet
                    {(warnings?.length ?? 0) > 1 ? 's' : ''} détecté
                    {(warnings?.length ?? 0) > 1 ? 's' : ''}
                  </div>
                  <ul className="space-y-1.5">
                    {warnings?.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Badge variant="outline" className="text-xs shrink-0 mt-0.5">
                          {w.style}
                        </Badge>
                        <span className="text-muted-foreground">{w.issue}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground pt-1">
                    Le modèle a été importé. Vous pouvez l'utiliser tel quel ou corriger ces styles
                    dans Word puis réimporter.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Fermer
              </Button>
              <Button onClick={handleConfirm}>Utiliser ce modèle</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
