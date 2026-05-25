import 'dotenv/config';
import { ShogiEngine } from './engine.js';
import { createEngineApp } from './api/createEngineApp.js';
import { getEnginePath } from './services/engine/engineClient.js';

const engine = new ShogiEngine(getEnginePath(), process.env.EVAL_DIR);
const app = createEngineApp(engine);
const PORT = parseInt(process.env.PORT ?? '8765', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
async function main() {
  if (process.env.ENABLE_SHOGI_ENGINE !== '0') {
    await engine.start();
    console.log('Shogi engine enabled');
  }

  app.listen(PORT, HOST, () => {
    console.log(`Engine server running on http://${HOST}:${PORT}`);
  });
}

void main().catch((error) => {
  console.error('Failed to start engine server:', error);
  process.exit(1);
});
