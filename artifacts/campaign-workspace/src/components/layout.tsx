import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Home, FolderGit2, Layers, Briefcase, Settings, Plus, Play, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: '/', label: 'Overview', icon: Home },
    { href: '/campaigns', label: 'Campaigns', icon: FolderGit2 },
    { href: '/portfolio', label: 'Portfolio', icon: Briefcase },
    { href: '/development', label: 'Development', icon: Layers },
    { href: '/governance', label: 'Governance', icon: Settings },
  ];

  return (
    <div className="min-h-screen w-full flex flex-col bg-background text-foreground">
      <header className="h-14 border-b border-border bg-card flex items-center px-6 justify-between shrink-0 sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
            <Layers className="h-5 w-5" />
            <span className="hidden sm:inline-block">Operating Workspace</span>
          </div>
          <nav className="flex items-center gap-1 border-l border-border pl-6">
            {navItems.map((item) => {
              const isActive = item.href === '/' ? location === '/' : location.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Synthetic planning only
          </div>
        </div>
      </header>
      <aside role="status" data-testid="open-development-banner" className="sticky top-14 z-40 border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-950">
        <strong>Open development — synthetic planning only.</strong>{' '}
        Attribution is unverified, not authenticated audit evidence. Simulated approvals are nonoperational.
        Live sending, publishing, customer-data exports, and real approvals remain blocked.
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}
