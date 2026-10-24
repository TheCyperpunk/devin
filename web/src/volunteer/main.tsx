// Volunteer app entry: registers the service worker (offline app shell) and mounts the React app.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '../styles.css';
import './volunteer.css';
import { App } from './App.js';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
