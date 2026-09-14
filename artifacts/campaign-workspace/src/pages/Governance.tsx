import { useEffect, useState } from 'react';
import {
  RecordType,
  useGetGovernance,
  useGetAdapterStatus,
  useListGovernanceTerms,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Database, Code, CheckCircle2, AlertCircle } from 'lucide-react';
import TaxonomyTerms from '@/components/governance/TaxonomyTerms';
import StagedImports from '@/components/governance/StagedImports';
import AuditLog from '@/components/governance/AuditLog';
import ApprovalsComments from '@/components/governance/ApprovalsComments';

export default function Governance() {
  const { data: governance } = useGetGovernance();
  const { data: adapters, isLoading: isAdaptersLoading } = useGetAdapterStatus();
  const { data: termsData, isLoading: isTermsLoading } = useListGovernanceTerms();
  const [selectedRecordId, setSelectedRecordId] = useState('');

  useEffect(() => {
    if (!selectedRecordId && termsData?.versionId) {
      setSelectedRecordId(termsData.terms[0]?.id ?? termsData.versionId);
    }
  }, [selectedRecordId, termsData]);

  const selectedRecordType: RecordType | null = selectedRecordId
    ? selectedRecordId === termsData?.versionId
      ? RecordType.taxonomyVersion
      : termsData?.terms.some((term) => term.id === selectedRecordId)
        ? RecordType.taxonomyTerm
        : null
    : null;

  return (
    <div className="flex-1 overflow-auto p-6 md:p-10 space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Governance</h1>
        <p className="text-muted-foreground">Taxonomy, naming conventions, and system integrations.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <TaxonomyTerms version={termsData?.version ?? governance?.version} />
          <StagedImports />
        </div>
        <div className="space-y-6">
          <AuditLog />
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Governance record</CardTitle>
              <CardDescription>Select an actual current taxonomy term or version for approvals and comments.</CardDescription>
            </CardHeader>
            <CardContent>
              {isTermsLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : termsData?.versionId ? (
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={selectedRecordId}
                  onChange={(event) => setSelectedRecordId(event.target.value)}
                >
                  <option value={termsData.versionId}>Taxonomy version {termsData.version}</option>
                  {termsData.terms.map((term) => (
                    <option key={term.id} value={term.id}>{term.category}: {term.label} ({term.shortcode})</option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-muted-foreground">No current taxonomy version was returned.</div>
              )}
            </CardContent>
          </Card>
          {selectedRecordType && selectedRecordId && (
            <ApprovalsComments recordType={selectedRecordType} recordId={selectedRecordId} />
          )}

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code className="h-5 w-5 text-primary" />
                Adapter Status
              </CardTitle>
              <CardDescription>Downstream platform sync health</CardDescription>
            </CardHeader>
            <CardContent>
              {isAdaptersLoading ? (
                <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : !adapters ? (
                <div className="text-sm text-muted-foreground">No adapter data found.</div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg border border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                        <Database className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <div className="font-medium">Airtable Source</div>
                        <div className="text-xs text-muted-foreground">Master record sync</div>
                      </div>
                    </div>
                    {adapters.airtable.status === 'connected' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    )}
                  </div>
                  <div className="p-4 rounded-lg border border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
                        <Code className="h-5 w-5 text-purple-600" />
                      </div>
                      <div>
                        <div className="font-medium">AI Generation</div>
                        <div className="text-xs text-muted-foreground">Content model service</div>
                      </div>
                    </div>
                    {adapters.ai.status === 'ready' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}