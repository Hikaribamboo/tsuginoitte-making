import 'dotenv/config';
import { isIP } from 'node:net';
import os from 'node:os';
import { ShogiEngine } from './engine.js';
import { createEngineApp } from './api/createEngineApp.js';
import { getEnginePath } from './services/engine/engineClient.js';

const engine = new ShogiEngine(getEnginePath(), process.env.EVAL_DIR);
const app = createEngineApp(engine);
const PORT = parseInt(process.env.PORT ?? '8765', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

function assertHostIsAvailable(host: string): void {
  if (!isIP(host) || host === '0.0.0.0' || host === '::') return;

  const localAddresses = Object.values(os.networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .map((address) => address.address);

  if (!localAddresses.includes(host)) {
    throw new Error(
      `HOST=${host} is not assigned to this machine. ` +
      'Use HOST=0.0.0.0, or update HOST to the IPv4 shown by "tailscale ip -4".',
    );
  }
}

function listen(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      server.removeListener('error', reject);
      console.log(`Engine server running on http://${HOST}:${PORT}`);
      resolve();
    });
    server.once('error', reject);
  });
}

function formatStartupError(error: unknown): unknown {
  const nodeError = error as Error & { code?: string; address?: string; port?: number };
  if (nodeError.code === 'EADDRINUSE') {
    return new Error(
      `Port ${nodeError.port ?? PORT} is already in use. ` +
      'Stop the existing engine-server process, or set a different PORT.',
    );
  }
  if (nodeError.code === 'EADDRNOTAVAIL') {
    return new Error(
      `HOST=${nodeError.address ?? HOST} is not assigned to this machine. ` +
      'Use HOST=0.0.0.0, or update HOST to the IPv4 shown by "tailscale ip -4".',
    );
  }
  return error;
}

async function main() {
  assertHostIsAvailable(HOST);

  if (process.env.ENABLE_SHOGI_ENGINE !== '0') {
    await engine.start();
    console.log('Shogi engine enabled');
  }

  await listen();
}

void main().catch((error) => {
  engine.stop();
  console.error('Failed to start engine server:', formatStartupError(error));
  process.exit(1);
});
