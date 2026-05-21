import { useCollection } from '@/lib/collection-context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Layers, Lock } from 'lucide-react';

export function CollectionSelector() {
  const { activeCollection, setActiveCollection, collections, isReadOnly } = useCollection();

  if (collections.length <= 1) return null;

  return (
    <Select value={activeCollection} onValueChange={setActiveCollection}>
      <SelectTrigger className="h-8 w-auto text-sm px-3 min-w-[150px] text-muted-foreground hover:text-foreground bg-muted/50 border-0">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 shrink-0" />
          {!!isReadOnly && <Lock className="h-3.5 w-3.5 shrink-0" />}
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {collections.map((c) => (
          <SelectItem key={c.slug} value={c.slug}>
            <span className="flex items-center gap-2">
              {c.name}
              {!!c.read_only && <Lock className="h-3 w-3 text-muted-foreground" />}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
