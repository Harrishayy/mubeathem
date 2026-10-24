import '@cue/ui/styles.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { demoStore } from './demo/runner';
import { callStore } from './state/call';
import { registerServiceWorker } from './sw-register';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();

// Read-only handles for the end-to-end tests and the demo operator's console.
Object.assign(window, { __cue: { demo: demoStore, call: callStore } });
