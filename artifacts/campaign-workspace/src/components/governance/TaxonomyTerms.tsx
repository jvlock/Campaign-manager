import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronRight, History, Loader2 } from 'lucide-react';
import { useListGovernanceTerms } from '@workspace/api-client-react';
import { ProvisionalBadge } from './ProvisionalNotice';

export default function TaxonomyTerms({ version }: { version?: string }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data: termsData, isLoading } = useListGovernanceTerms();

  const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  if (isLoading) {
    return (
      <Card className="shadow-sm">
        <CardHeader><CardTitle>Taxonomy & Hierarchy</CardTitle></CardHeader>
        <CardContent className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent>
      </Card>
    );
  }

  const terms = termsData?.terms || [];

  // Registered categories remain visible before any values are approved or added.
  const registeredCategories = Object.fromEntries(
    (termsData?.categories ?? []).map(category => [category, [] as typeof terms])
  );
  const categoriesMap = terms.reduce((acc, term) => {
    if (!acc[term.category]) acc[term.category] = [];
    acc[term.category].push(term);
    return acc;
  }, registeredCategories as Record<string, typeof terms>);

  const categories = Object.keys(categoriesMap).map(cat => ({
    id: cat,
    label: cat.replaceAll('_', ' '),
    current: categoriesMap[cat]
  }));

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Taxonomy & Hierarchy</CardTitle>
        <CardDescription>Quarantined source terms retained for draft planning and business validation. {version && `(v${version})`}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {categories.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md">No taxonomy terms found.</div>
        ) : categories.map(cat => (
          <div key={cat.id} className="border border-border rounded-md overflow-hidden">
            <button 
              className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 text-sm font-medium"
              onClick={() => toggle(cat.id)}
            >
              <div className="flex items-center gap-2 capitalize">
                {expanded[cat.id] ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                {cat.label}
                 <code className="text-[10px] normal-case text-muted-foreground">{cat.id}</code>
              </div>
              <span className="text-xs text-muted-foreground">{cat.current.length} terms</span>
            </button>
            {expanded[cat.id] && (
              <div className="p-3 bg-background divide-y divide-border">
                {cat.current.length === 0 && (
                  <p className="text-sm text-muted-foreground">No values seeded in this category.</p>
                )}
                {cat.current.map(term => (
                  <div key={term.id} className="py-2 first:pt-0 last:pb-0 flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium flex items-center gap-2">
                        {term.label} <span className="px-1.5 py-0.5 bg-secondary/10 text-secondary text-[10px] rounded font-mono">{term.shortcode}</span>
                        <ProvisionalBadge />
                        {term.isDeprecated && <span className="text-xs text-muted-foreground">Deprecated</span>}
                      </div>
                      {term.stableKey && (
                        <div className="text-xs text-muted-foreground mt-1 break-all">
                          Stable key: <code>{term.stableKey}</code>
                        </div>
                      )}
                      {term.parentId && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Parent: {(() => {
                            const parent = terms.find(candidate => candidate.id === term.parentId);
                            return parent ? `${parent.label} (${parent.stableKey ?? parent.shortcode})` : term.parentId;
                          })()}
                        </div>
                      )}
                      {term.supersededBy && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <History className="h-3 w-3" /> Superseded by: {terms.find(candidate => candidate.id === term.supersededBy)?.label ?? term.supersededBy}
                        </div>
                      )}
                      {term.legacyCodes?.length > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          Legacy: {term.legacyCodes.join(', ')}
                        </div>
                      )}
                      {'sourceMetadata' in term && !!term.sourceMetadata && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Source: {String((term.sourceMetadata as { sourceLabel?: string }).sourceLabel ?? 'Not specified')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
