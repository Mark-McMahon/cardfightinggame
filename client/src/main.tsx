// React root. styles.css is imported here (not <link>ed in index.html) so Vite bundles + hashes
// the carried-forward stylesheet into the build.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
