import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { handleInspectRequest } from './lib/inspect.js';

/** Mounts the same handler Vercel serves at `/api/inspect`, so dev and production match. */
const serveInspect: Connect.NextHandleFunction = async (req, res, next) => {
  if (!req.url?.startsWith('/api/inspect')) return next();
  const response = await handleInspectRequest(new Request(new URL(req.url, 'http://localhost')));
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(await response.text());
};

const inspectApi = (): Plugin => ({
  name: 'inspect-api',
  configureServer: (server) => {
    server.middlewares.use(serveInspect);
  },
  configurePreviewServer: (server) => {
    server.middlewares.use(serveInspect);
  },
});

export default defineConfig({
  plugins: [react(), inspectApi()],
});
