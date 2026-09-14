import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronRight, History, Loader2 } from 'lucide-react';
import { useListGovernanceTerms } from '@workspace/api-client-react';

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

  // Group terms by category
  const categoriesMap = terms.reduce((acc, term) => {
    if (!acc[term.category]) acc[term.category] = [];
    acc[term.category].push(term);
    return acc;
  }, {} as Record<string, typeof terms>);

  const categories = Object.keys(categoriesMap).map(cat => ({
    id: cat,
    label: cat.replaceAll('_', ' '),
    current: categoriesMap[cat]
  }));

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Taxonomy & Hierarchy</CardTitle>
        <CardDescription>Active terms, legacy mappings, and superseded values. {version && `(v${version})`}</CardDescription>
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
              </div>
              <span className="text-xs text-muted-foreground">{cat.current.length} terms</span>
            </button>
            {expanded[cat.id] && (
              <div className="p-3 bg-background divide-y divide-border">
                {cat.current.map(term => (
                  <div key={term.id} className="py-2 first:pt-0 last:pb-0 flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium flex items-center gap-2">
                        {term.label} <span className="px-1.5 py-0.5 bg-secondary/10 text-secondary text-[10px] rounded font-mono">{term.shortcode}</span>
                      </div>
                      {term.supersededBy && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <History className="h-3 w-3" /> Replaces: {term.supersededBy}
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
