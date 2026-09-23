import { useEffect, useState } from 'react';

type AccessState =
  | 'checking'
  | 'authentication-unavailable'
  | 'authentication-required'
  | 'limited'
  | 'error';

function App() {
  const [access, setAccess] = useState<AccessState>('checking');

  useEffect(() => {
    const controller = new AbortController();

    async function checkAccess() {
      try {
        // Check the protected, bounded read surface, not public /api/healthz.
        // A successful check does not enable legacy product operations.
        const response = await fetch('/api/organization/campaigns', {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (controller.signal.aborted) return;

        if (response.ok) {
          setAccess('limited');
          return;
        }

        const body: unknown = await response.json();
        if (controller.signal.aborted) return;
        const code =
          body && typeof body === 'object' && 'error' in body &&
          body.error && typeof body.error === 'object' && 'code' in body.error
            ? body.error.code
            : undefined;

        if (response.status === 503 && code === 'AUTHENTICATION_UNAVAILABLE') {
          setAccess('authentication-unavailable');
        } else if (response.status === 403) {
          setAccess('limited');
        } else if (response.status === 401) {
          setAccess('authentication-required');
        } else {
          setAccess('error');
        }
      } catch {
        if (!controller.signal.aborted) setAccess('error');
      }
    }

    void checkAccess();
    return () => controller.abort();
  }, []);

  const content = {
    checking: {
      title: 'Checking protected access',
      description: 'Confirming whether organizational campaign access is available.',
    },
    'authentication-unavailable': {
      title: 'Protected access is unavailable',
      description: 'Trusted authentication is not available. Organizational records are not accessible, and live workspace capabilities remain disabled until trusted authentication and provisioning are in place.',
    },
    'authentication-required': {
      title: 'Verified access required',
      description: 'A verified identity is required to access organizational records. This workspace does not provide a sign-in flow yet.',
    },
    limited: {
      title: 'Workspace access is limited',
      description: 'The legacy product screens are disabled. Historical records have not been migrated into organizational access; additional live capabilities require trusted authentication, provisioning, and approval.',
    },
    error: {
      title: 'Unable to confirm protected access',
      description: 'The organizational access check could not be completed. No campaign data is shown while access cannot be confirmed.',
    },
  }[access];

  return (
    <main className="min-h-screen bg-background px-6 py-20 text-foreground">
      <section
        aria-live="polite"
        className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 shadow-sm"
        data-testid="status-protected-access"
      >
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Campaign Operating Workspace
        </p>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-access-title">
          {content.title}
        </h1>
        <p className="mt-4 leading-relaxed text-muted-foreground" data-testid="text-access-description">
          {content.description}
        </p>
      </section>
    </main>
  );
}

export default App;