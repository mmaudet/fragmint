import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PlusCircle, Trash2 } from 'lucide-react';

export interface StructuredDataDef {
  key: string;
  source: string;
  schema: Record<string, string>;
}

interface Props {
  defs: StructuredDataDef[];
  value: Record<string, Array<Record<string, any>>>;
  onChange: (key: string, rows: Array<Record<string, any>>) => void;
}

function emptyRow(schema: Record<string, string>): Record<string, any> {
  const row: Record<string, any> = {};
  for (const [field, type] of Object.entries(schema)) {
    row[field] = type === 'number' ? 0 : '';
  }
  return row;
}

export function StructuredDataEditor({ defs, value, onChange }: Props) {
  if (defs.length === 0) return null;

  return (
    <div className="space-y-6">
      {defs.map((def) => {
        const rows = value[def.key] ?? [];
        const columns = Object.entries(def.schema);

        const addRow = () => onChange(def.key, [...rows, emptyRow(def.schema)]);

        const deleteRow = (i: number) =>
          onChange(
            def.key,
            rows.filter((_, idx) => idx !== i),
          );

        const updateCell = (rowIdx: number, field: string, raw: string) => {
          const type = def.schema[field];
          const val = type === 'number' ? (raw === '' ? 0 : Number(raw)) : raw;
          const updated = rows.map((r, i) => (i === rowIdx ? { ...r, [field]: val } : r));
          onChange(def.key, updated);
        };

        return (
          <div key={def.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{def.key}</p>
              <Button variant="outline" size="sm" onClick={addRow}>
                <PlusCircle className="mr-1 h-3.5 w-3.5" />
                Ajouter une ligne
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map(([field]) => (
                    <TableHead key={field} className="text-xs">
                      {field}
                    </TableHead>
                  ))}
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length + 1}
                      className="text-center text-xs text-muted-foreground py-4"
                    >
                      Aucune ligne — cliquez sur «&nbsp;Ajouter une ligne&nbsp;»
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row, rowIdx) => (
                  <TableRow key={rowIdx}>
                    {columns.map(([field, type]) => (
                      <TableCell key={field} className="py-1 pr-2">
                        <Input
                          className="h-7 text-xs"
                          type={type === 'number' ? 'number' : 'text'}
                          value={row[field] ?? ''}
                          onChange={(e) => updateCell(rowIdx, field, e.target.value)}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => deleteRow(rowIdx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}
