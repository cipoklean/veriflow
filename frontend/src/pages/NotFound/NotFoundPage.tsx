import { Link } from 'react-router-dom';
import { Compass, ArrowLeft } from 'lucide-react';
import { Wave } from '@/components/ui/Wave';

/**
 * FE-03: catch-all 404 page. Render for any unknown path via the router's
 * `path="*"` route.
 */
export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-24 text-center">
      <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-teal/10">
        <Compass className="h-8 w-8 text-accent-teal" />
      </div>
      <p className="mb-2 font-mono text-sm uppercase tracking-[0.2em] text-text-muted">Error 404</p>
      <h1 className="font-display text-3xl font-bold text-text-primary">Page not found</h1>
      <p className="mt-3 max-w-md text-text-secondary">
        The page you're looking for doesn't exist or has moved.
      </p>
      <div className="mt-6 w-48">
        <Wave className="opacity-70" />
      </div>
      <Link to="/" className="btn-primary mt-8 gap-2">
        <ArrowLeft className="h-4 w-4" />
        Return to Dashboard
      </Link>
    </div>
  );
}
