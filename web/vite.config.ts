// Vite config: two entry pages (phone "/", big screen "/screen.html") and the phone's PWA service worker.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pralayam',
        short_name: 'Pralayam',
        description: 'The flood night. Crew a boat. Works without Internet.',
        lang: 'en',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0b0b14',
        theme_color: '#0b0b14',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the phone app shell only. /api/* must never be cached or served from the SW.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // The big screen runs on the hub laptop and must always come fresh from the hub.
        globIgnores: ['**/screen.html', '**/assets/screen-*'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/screen/, /^\/ws/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'https://localhost:3443', secure: false },
    },
  },
  build: {
    rollupOptions: {
      input: {
        play: resolve(__dirname, 'index.html'),
        screen: resolve(__dirname, 'screen.html'),
      },
    },
  },
});
