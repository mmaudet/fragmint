import { useNavigate } from 'react-router-dom';
import { useInventory } from '@/api/hooks/use-inventory';
import { QualityBadge } from '@/components/quality-badge';
import { CoverageBar } from '@/components/coverage-bar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export default function InventoryPage() {
  const navigate = useNavigate();
  const { data: inventory, isLoading, error } = useInventory();

  if (error) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">Inventaire</h2>
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          Erreur lors du chargement de l&apos;inventaire : {error.message}
        </div>
      </div>
    );
  }

  const byQuality = inventory?.by_quality ?? {};
  const approved = byQuality['approved'] ?? 0;
  const reviewed = byQuality['reviewed'] ?? 0;
  const draft = byQuality['draft'] ?? 0;
  const total = inventory?.total ?? 0;

  const byLang = inventory?.by_lang ?? {};
  const frTotal = Object.values(byLang['fr'] ?? {}).reduce((sum, n) => sum + n, 0);
  const enTotal = Object.values(byLang['en'] ?? {}).reduce((sum, n) => sum + n, 0);

  const gaps = inventory?.gaps ?? [];

  return (
    <div className="p-6 space-y-8">
      <h2 className="text-2xl font-bold">Inventaire</h2>

      {/* Top metrics row */}
      {isLoading ? (
        <MetricsSkeleton />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total fragments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                Approved <QualityBadge quality="approved" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{approved}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                Reviewed <QualityBadge quality="reviewed" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{reviewed}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                Draft <QualityBadge quality="draft" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{draft}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Coverage section */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Couverture par domaine</h3>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <CoverageBar fr={frTotal} en={enTotal} label="Toutes langues" />
        )}
      </section>

      {/* Gaps table */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Lacunes d&eacute;tect&eacute;es</h3>
        {isLoading ? (
          <TableSkeleton />
        ) : gaps.length === 0 ? (
          <p className="text-muted-foreground">Aucune lacune d&eacute;tect&eacute;e.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Domaine</TableHead>
                  <TableHead>Langue</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gaps.map((gap, i) => (
                  <TableRow
                    key={`${gap.type}-${gap.domain}-${gap.lang}-${i}`}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() =>
                      navigate(
                        `/fragments?type=${encodeURIComponent(gap.type)}&domain=${encodeURIComponent(gap.domain)}&lang=${encodeURIComponent(gap.lang)}`,
                      )
                    }
                  >
                    <TableCell>{gap.type}</TableCell>
                    <TableCell>{gap.domain}</TableCell>
                    <TableCell>{gap.lang}</TableCell>
                    <TableCell>
                      {gap.status === 'no_approved' ? (
                        <Badge variant="destructive">no_approved</Badge>
                      ) : gap.status === 'missing_translation' ? (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200" variant="outline">
                          missing_translation
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{gap.status}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
