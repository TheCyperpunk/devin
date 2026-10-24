// Coordinator dashboard entry. No service worker here: the dashboard runs on the laptop that hosts the hub.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import './dashboard.css';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
