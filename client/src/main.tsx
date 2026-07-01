// React root. styles.css is imported here (not <link>ed in index.html) so Vite bundles + hashes
// the carried-forward stylesheet into the build.

import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
// DEV-ONLY: #replay-lab renders the combat-replay workbench instead of the app (see ReplayLab.tsx).
// Lazy-imported so the harness (and its demo boards) is code-split out of the shipped bundle.
const isLab = typeof window !== 'undefined' && window.location.hash.startsWith('#replay-lab');
const ReplayLab = lazy(() => import('./scenes/ReplayLab'));
createRoot(root).render(<StrictMode>{isLab ? <Suspense fallback={null}><ReplayLab /></Suspense> : <App />}</StrictMode>);
