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
import { useI18n } from '@/lib/i18n';
import { toast } from 'sonner';

export function UploadStyleTemplateDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUploaded: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const upload = useUploadStyleTemplate();
  const { t } = useI18n();

  async function handleUpload() {
    if (!file || !name) {
      toast.error('Pick a file and provide a name');
      return;
    }
    const created = await upload.mutateAsync({ file, name, description: description || undefined });
    onUploaded(created.id);
    onOpenChange(false);
    setFile(null);
    setName('');
    setDescription('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('planGeneration', 'uploadStyleTemplate')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="file"
            accept=".docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleUpload} disabled={upload.isPending}>Upload</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
