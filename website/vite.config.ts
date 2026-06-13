import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const basePath = env.VITE_BASE_PATH?.trim() || '/kuviewer/';

export default defineConfig({
  base: basePath,
  plugins: [react()],
});
