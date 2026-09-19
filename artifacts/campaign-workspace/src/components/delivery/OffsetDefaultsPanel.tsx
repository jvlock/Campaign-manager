import { useState } from 'react';
import { useGetTaskDefaults, useUpdateTaskDefaults, getGetTaskDefaultsQueryKey } from '@workspace/api-client-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';

export default function OffsetDefaultsPanel() {
  const qc = useQueryClient();
  const { data: defaults = [], isLoading } = useGetTaskDefaults();
  
  const [editType, setEditType] = useState<string | null>(null);
  const [offsetVal, setOffsetVal] = useState<number>(0);
  const [saveError, setSaveError] = useState('');

  const updateDefault = useUpdateTaskDefaults({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetTaskDefaultsQueryKey() });
        qc.invalidateQueries(); // broadly invalidate tasks when defaults change
        setEditType(null);
        setSaveError('');
      },
      onError: (err: any) => {
        setSaveError(err?.message || 'Failed to save offset');
      }
    }
  });
  
  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading defaults...</div>;

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-md p-6">
        <h3 className="text-lg font-semibold mb-2">Configurable Offset Defaults</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
          Reference table for default scheduling offsets by task type. Editable by marketers. These are applied automatically unless overridden on the individual task.
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
                <TableHead>Task Type</TableHead>
                <TableHead>Default Offset (Days)</TableHead>
                <TableHead>Business Day Strategy</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border">
               {defaults.length === 0 ? (
                 <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No defaults configured.</TableCell></TableRow>
               ) : defaults.map((def) => {
                 const isEditing = editType === def.type;
                 return (
                 <TableRow key={def.type} className="hover:bg-muted/30">
                   <TableCell className="font-medium">
                     {def.type}
                     {def.label && <span className="ml-2 text-xs text-muted-foreground">({def.label})</span>}
                   </TableCell>
                   <TableCell>
                     {isEditing ? (
                       <Input type="number" value={offsetVal} onChange={e => setOffsetVal(Math.round(Number(e.target.value)))} className="h-8 w-20" />
                     ) : (
                       <span>{def.offsetDays} days</span>
                     )}
                   </TableCell>
                   <TableCell className="capitalize text-muted-foreground italic">Business day strategy not editable here.</TableCell>
                   <TableCell className="text-right">
                     {isEditing ? (
                       <div className="flex gap-2 justify-end">
                         <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setEditType(null); setSaveError(''); }} disabled={updateDefault.isPending}>Cancel</Button>
                         <Button size="sm" className="h-8 text-xs" disabled={updateDefault.isPending} onClick={() => {
                           const newDefaults = defaults.map(d => 
                             d.type === def.type ? { type: d.type, offsetDays: offsetVal } : { type: d.type, offsetDays: d.offsetDays }
                           );
                           updateDefault.mutate({ data: { defaults: newDefaults } });
                         }}>
                           {updateDefault.isPending ? 'Saving...' : 'Save'}
                         </Button>
                       </div>
                     ) : (
                       <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setEditType(def.type); setOffsetVal(def.offsetDays); setSaveError(''); }} disabled={updateDefault.isPending}>Edit Rules</Button>
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
