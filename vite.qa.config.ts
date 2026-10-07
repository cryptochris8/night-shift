// Dev server for automated QA runs (tools/*.mjs): no file watching / HMR, so edits made while a
// run is in progress cannot reload the page underneath it.
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, defineConfig({ server: { hmr: false, watch: null } }));
