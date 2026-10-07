// Dev server for automated QA runs (tools/*.mjs): no file watching / HMR, so edits made while a
// run is in progress cannot reload the page underneath it, and its own dependency cache, so a QA run
// never re-optimizes the deps a running `npm run dev` is serving.
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({ cacheDir: 'node_modules/.vite-qa', server: { hmr: false, watch: null } }));
