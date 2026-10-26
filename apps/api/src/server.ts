import { buildApp } from './app.js';
import { readBackendEnv } from './env.js';

const env = readBackendEnv();
const app = await buildApp({ env });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
await app.listen({ host: '0.0.0.0', port: env.port });
console.info(`AET API listening on port ${env.port}`);
