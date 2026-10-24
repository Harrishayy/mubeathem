import '@cue/ui/styles.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { callStore } from './state/call';
import { connectExtension } from './state/extension';
import { registerServiceWorker } from './sw-register';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
connectExtension();

// Read-only handle for the end-to-end tests.
Object.assign(window, { __cue: { call: callStore } });
