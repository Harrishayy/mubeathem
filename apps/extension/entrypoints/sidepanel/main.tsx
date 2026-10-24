import '@cue/ui/styles.css';
import './sidepanel.css';
import { FONT_HREF } from '@cue/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const fonts = document.createElement('link');
fonts.rel = 'stylesheet';
fonts.href = FONT_HREF;
document.head.append(fonts);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
