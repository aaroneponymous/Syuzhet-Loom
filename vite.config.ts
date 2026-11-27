import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { responsesPlugin } from './responses-plugin';

// Relative base so the static build works from any folder or sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), responsesPlugin()],
  build: { chunkSizeWarningLimit: 1500 },
});
