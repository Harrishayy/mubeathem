import '@cue/ui/styles.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { callStore } from './state/call';
import { registerServiceWorker } from './sw-register';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();

// Read-only handle for the end-to-end tests.
Object.assign(window, { __cue: { call: callStore } });
