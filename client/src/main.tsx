// React root. styles.css is imported here (not <link>ed in index.html) so Vite bundles + hashes
// the carried-forward stylesheet into the build.

import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

// Hash-routed standalone pages, code-split out of the shipped app bundle:
//  • #replay-lab — DEV-ONLY combat-replay workbench (see ReplayLab.tsx).
//  • #cards      — the browsable card catalog (see CardCatalog.tsx).
// Everything else renders the live game <App>. Root re-renders on `hashchange`, so links between the
// app and these pages navigate instantly without a full reload.
const ReplayLab = lazy(() => import('./scenes/ReplayLab'));
const CardCatalog = lazy(() => import('./scenes/CardCatalog'));

function Root(): ReactNode {
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''));
  useEffect(() => {
    const onHash = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (hash.startsWith('#replay-lab')) return <Suspense fallback={null}><ReplayLab /></Suspense>;
  if (hash.startsWith('#cards')) return <Suspense fallback={null}><CardCatalog /></Suspense>;
  return <App />;
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(<StrictMode><Root /></StrictMode>);
