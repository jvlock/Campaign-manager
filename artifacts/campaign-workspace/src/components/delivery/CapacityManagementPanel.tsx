import { useState } from 'react';
import { useGetOwnerCapacities, useUpdateOwnerCapacities, getGetOwnerCapacitiesQueryKey } from '@workspace/api-client-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useQueryClient } from '@tanstack/react-query';

export default function CapacityManagementPanel({ campaignId }: { campaignId: string }) {
  const qc = useQueryClient();
  const { data: capacities = [], isLoading } = useGetOwnerCapacities();
  const [editOwner, setEditOwner] = useState<string | null>(null);
  const [ceilingVal, setCeilingVal] = useState(10);
  const [saveError, setSaveError] = useState('');

  const updateCapacity = useUpdateOwnerCapacities({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetOwnerCapacitiesQueryKey() });
        qc.invalidateQueries(); // invalidate everything related to capacities/campaigns/delivery
        setEditOwner(null);
        setSaveError('');
      },
      onError: (err: any) => {
        setSaveError(err?.message || 'Failed to save capacity');
      }
    }
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading capacity...</div>;

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-md p-6">
        <h3 className="text-lg font-semibold mb-2">Team Capacity</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
          Sums ALL owner's active (not Complete) task effort cross-campaign, including blocked tasks.
          Configurable per-owner ceiling. Default ceiling is 10 explicitly. Supporting owners are not counted twice.
        </p>
        
        <div className="border border-border rounded-md overflow-hidden">
          {saveError && (
            <div className="bg-destructive/10 text-destructive text-sm px-4 py-2 font-medium border-b border-destructive/20">
              {saveError}
            </div>
          )}
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>Current Effort</TableHead>
                <TableHead>Ceiling</TableHead>
                <TableHead className="w-[300px]">Utilization</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border">
              {capacities.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No active owners found.</TableCell></TableRow>
              ) : capacities.map((cap) => {
                const util = cap.ceiling > 0
                  ? Math.round(((cap.totalEffort ?? 0) / cap.ceiling) * 100)
                  : (cap.totalEffort ?? 0) > 0 ? null : 0;
                const isEditing = editOwner === cap.owner;
                
                return (
                  <TableRow key={cap.owner} className="hover:bg-muted/30">
                    <TableCell className="font-medium">
                      {cap.owner}
                      {cap.label && <span className="ml-2 text-xs text-muted-foreground">({cap.label})</span>}
                    </TableCell>
                    <TableCell>{cap.totalEffort || 0} points</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input type="number" min="0" value={ceilingVal} onChange={e => setCeilingVal(Math.max(0, Number(e.target.value)))} className="h-8 w-20" />
                      ) : (
                        <span className="inline-flex items-center justify-center min-w-[2rem]">{cap.ceiling}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Progress value={Math.min(100, util ?? 100)} className={`h-2 flex-1 ${cap.overallocated ? 'bg-destructive/20 [&>div]:bg-destructive' : ''}`} />
                        <span className={`text-xs shrink-0 font-medium ${cap.overallocated ? 'text-destructive' : 'text-muted-foreground'}`}>{util === null ? 'No capacity' : `${util}%`}</span>
                      </div>
                      {cap.overallocated && (
                        <p className="mt-1 text-xs font-medium text-destructive">
                          Overallocated · {Number(((cap.totalEffort ?? 0) - cap.ceiling).toFixed(2))} points over ceiling
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setEditOwner(null); setSaveError(''); }} disabled={updateCapacity.isPending}>Cancel</Button>
                           <Button size="sm" className="h-8 text-xs" disabled={updateCapacity.isPending || !Number.isFinite(ceilingVal) || ceilingVal < 0} onClick={() => {
                             updateCapacity.mutate({ data: { capacities: [{ owner: cap.owner, ceiling: ceilingVal }] } });
                          }}>
                            {updateCapacity.isPending ? 'Saving...' : 'Save'}
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setEditOwner(cap.owner); setCeilingVal(cap.ceiling); setSaveError(''); }} disabled={updateCapacity.isPending}>Edit Limit</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
