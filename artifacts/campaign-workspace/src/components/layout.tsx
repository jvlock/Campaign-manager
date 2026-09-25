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
    <div className="min-h-screen w-full max-w-full overflow-x-clip flex flex-col bg-background text-foreground">
      <header className="h-14 border-b border-border bg-card flex items-center px-3 sm:px-6 justify-between gap-2 shrink-0 sticky top-0 z-50 min-w-0 max-w-full">
        <div className="flex items-center gap-3 lg:gap-6 min-w-0">
          <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight shrink-0">
            <Layers className="h-5 w-5" />
            <span className="hidden xl:inline-block">Operating Workspace</span>
          </div>
          <nav aria-label="Primary" className="flex items-center gap-1 border-l border-border pl-2 lg:pl-6 min-w-0 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = item.href === '/' ? location === '/' : location.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    "shrink-0 min-h-9 px-2 lg:px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon aria-hidden="true" className="h-4 w-4" />
                  <span className="hidden lg:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="hidden md:flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Synthetic planning only
          </div>
        </div>
      </header>
      <div role="status" data-testid="open-development-banner" className="sticky top-14 z-40 border-b border-amber-300 bg-amber-50 px-3 sm:px-6 py-3 break-words text-sm text-amber-950">
        <strong>Open development — synthetic planning only.</strong>{' '}
        Attribution is unverified, not authenticated audit evidence. Simulated approvals are nonoperational.
        Live sending, publishing, customer-data exports, and real approvals remain blocked.
      </div>
      <main className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        {children}
      </main>
    </div>
  );
}
