import { spawn, ChildProcess } from 'child_process';
import { chmodSync, accessSync, constants as fsConst } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export interface EngineResult {
  eval_cp: number;
  pv: string[];
  bestmove: string;
}

export interface AnalysisLine {
  multipv: number;
  depth: number;
  eval_cp: number;
  mate: number | null;
  pv: string[];
}

interface EvaluateOptions {
  depth?: number;
  nodes?: number;
  stable?: boolean;
  searchMoves?: string[];
}

/**
 * Manages communication with a USI engine process.
 */
export class ShogiEngine {
  private process: ChildProcess | null = null;
  private ready = false;
  private enginePath: string;
  private evalDir: string;
  private buffer = '';
  private resolveQueue: Array<{
    resolve: (lines: string[]) => void;
    terminator: string;
  }> = [];
  private collectedLines: string[] = [];
  private supportedOptions = new Set<string>();

  private static readonly DEFAULT_THREADS = 8;
  private static readonly DEFAULT_CORES = 8;

  // For streaming analysis
  public analysisEmitter = new EventEmitter();
  private analyzing = false;

  constructor(enginePath?: string, evalDir?: string) {
    const root = path.resolve(import.meta.dirname, '..', '..');
    if (enginePath) {
      this.enginePath = enginePath;
    } else {
      const isMac = process.platform === 'darwin';
      this.enginePath = path.join(
        root, 'engines',
        isMac ? 'mac' : 'windows',
        isMac ? 'YaneuraOu.exe' : 'AobaNNUE_AVX2.exe',
      );
    }
    this.evalDir = evalDir ?? path.join(root, 'engines', 'eval');
  }

  async start(): Promise<void> {
    if (this.process) return;

    // Ensure the engine binary is executable
    try {
      accessSync(this.enginePath, fsConst.X_OK);
    } catch {
      chmodSync(this.enginePath, 0o755);
    }

    console.log(`Starting engine: ${this.enginePath}`);
    console.log(`Eval dir: ${this.evalDir}`);

    this.process = spawn(this.enginePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.dirname(this.enginePath),
    });

    this.process.stdout!.setEncoding('utf-8');
    this.process.stdout!.on('data', (data: string) => {
      this.buffer += data;
      this.processBuffer();
    });

    this.process.stderr!.on('data', (data: Buffer) => {
      console.error('[engine stderr]', data.toString());
    });

    this.process.on('exit', (code) => {
      console.log(`Engine exited with code ${code}`);
      this.process = null;
      this.ready = false;
    });

    // Initialize USI
    const usiLines = await this.sendAndWait('usi', 'usiok');
    this.captureSupportedOptions(usiLines);
    console.log('USI init done');

    // Set eval dir and performance options (match ShogiGUI defaults)
    this.send(`setoption name EvalDir value ${this.evalDir}`);
    this.send('setoption name USI_Hash value 1024');
    this.send(`setoption name Threads value ${ShogiEngine.DEFAULT_THREADS}`);
    this.send('setoption name PvInterval value 300');
    this.setOptionIfSupported('Cores', String(ShogiEngine.DEFAULT_CORES));
    this.send('setoption name MultiPV value 3');

    // Check ready
    await this.sendAndWait('isready', 'readyok');
    this.ready = true;
    console.log('Engine ready');
  }

  async evaluate(sfen: string, moves: string[] = [], options: EvaluateOptions = {}): Promise<EngineResult> {
    if (!this.ready) throw new Error('Engine not ready');

    const {
      depth = 20,
      nodes,
      stable = false,
      searchMoves = [],
    } = options;

    // Stop any ongoing analysis
    if (this.analyzing) {
      await this.stopAnalysis();
    }

    // Reset MultiPV to 1 so we only get the best line.
    // (startAnalysis may have set it to 5.)
    this.send('setoption name MultiPV value 1');

    // Stable mode for repeatable choice scoring: single-thread + clear hash.
    if (stable) {
      this.send('setoption name Threads value 1');
      this.send('setoption name Clear Hash');
    }

    await this.sendAndWait('isready', 'readyok');

    let posCmd = `position sfen ${sfen}`;
    if (moves.length > 0) {
      posCmd += ` moves ${moves.join(' ')}`;
    }
    this.send(posCmd);

    const baseGoCmd = typeof nodes === 'number' ? `go nodes ${nodes}` : `go depth ${depth}`;
    const goCmd = searchMoves.length > 0
      ? `${baseGoCmd} searchmoves ${searchMoves.join(' ')}`
      : baseGoCmd;
    const lines = await this.sendAndWait(goCmd, 'bestmove');

    let evalCp = 0;
    let pv: string[] = [];
    let bestmove = '';

    for (const line of lines) {
      if (line.startsWith('bestmove')) {
        const parts = line.split(' ');
        bestmove = parts[1] ?? '';
      }

      // Match only multipv 1 (or lines without multipv token) at the target depth.
      // Use word-boundary regex to avoid e.g. "depth 2" matching "depth 24".
      if (typeof nodes !== 'number') {
        const depthRe = new RegExp(`\\bdepth ${depth}\\b`);
        if (!depthRe.test(line)) continue;
      }
      // Skip non-best multipv lines (multipv 2, 3, …)
      if (line.includes('multipv') && !line.includes('multipv 1 ')) continue;

      if (line.includes('score cp')) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        if (cpMatch) evalCp = parseInt(cpMatch[1], 10);
        const pvMatch = line.match(/ pv (.+)/);
        if (pvMatch) pv = pvMatch[1].split(' ');
      }

      if (line.includes('score mate')) {
        const mateMatch = line.match(/score mate (-?\d+)/);
        if (mateMatch) {
          evalCp = parseInt(mateMatch[1], 10) > 0 ? 30000 : -30000;
        }
        const pvMatch = line.match(/ pv (.+)/);
        if (pvMatch) pv = pvMatch[1].split(' ');
      }
    }

    if (evalCp === 0 && pv.length === 0) {
      // Fallback: find the deepest multipv-1 (or no-multipv) score line.
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        // Skip non-best multipv lines
        if (line.includes('multipv') && !line.includes('multipv 1 ')) continue;

        if (line.includes('score cp')) {
          const cpMatch = line.match(/score cp (-?\d+)/);
          if (cpMatch) evalCp = parseInt(cpMatch[1], 10);
          const pvMatch = line.match(/ pv (.+)/);
          if (pvMatch) pv = pvMatch[1].split(' ');
          break;
        }
        if (line.includes('score mate')) {
          const mateMatch = line.match(/score mate (-?\d+)/);
          if (mateMatch) {
            evalCp = parseInt(mateMatch[1], 10) > 0 ? 30000 : -30000;
          }
          const pvMatch = line.match(/ pv (.+)/);
          if (pvMatch) pv = pvMatch[1].split(' ');
          break;
        }
      }
    }

    if (stable) {
      // Restore default analysis performance settings.
      this.send(`setoption name Threads value ${ShogiEngine.DEFAULT_THREADS}`);
      await this.sendAndWait('isready', 'readyok');
    }

    return { eval_cp: evalCp, pv, bestmove };
  }

  /** Start infinite analysis (streaming MultiPV). Emits 'info' events. */
  startAnalysis(sfen: string, moves: string[] = [], multipv = 5): void {
    if (!this.ready) throw new Error('Engine not ready');

    // Stop any previous analysis first (synchronously send stop)
    if (this.analyzing) {
      this.send('stop');
      this.analyzing = false;
    }

    this.send(`setoption name MultiPV value ${multipv}`);
    // Need isready after setoption
    this.send('isready');

    let posCmd = `position sfen ${sfen}`;
    if (moves.length > 0) {
      posCmd += ` moves ${moves.join(' ')}`;
    }
    this.send(posCmd);
    this.send('go infinite');
    this.analyzing = true;
  }

  async stopAnalysis(): Promise<void> {
    if (!this.analyzing) return;
    this.send('stop');
    this.analyzing = false;
    // Wait for bestmove to fully stop
    await new Promise<void>((resolve) => {
      const handler = (line: string) => {
        if (line.startsWith('bestmove')) {
          this.analysisEmitter.removeListener('rawline', handler);
          resolve();
        }
      };
      this.analysisEmitter.on('rawline', handler);
      // Timeout safety
      setTimeout(() => {
        this.analysisEmitter.removeListener('rawline', handler);
        resolve();
      }, 2000);
    });
  }

  get isAnalyzing(): boolean {
    return this.analyzing;
  }

  stop(): void {
    if (this.process) {
      this.send('quit');
      this.process.kill();
      this.process = null;
      this.ready = false;
    }
  }

  // ---- Private methods ----

  private send(command: string): void {
    if (!this.process?.stdin?.writable) throw new Error('Engine stdin not writable');
    console.log(`[→engine] ${command}`);
    this.process!.stdin!.write(command + '\n');
  }

  private sendAndWait(command: string, terminator: string): Promise<string[]> {
    return new Promise((resolve) => {
      this.resolveQueue.push({ resolve, terminator });
      this.send(command);
    });
  }

  private setOptionIfSupported(name: string, value: string): void {
    if (!this.supportedOptions.has(name)) {
      console.warn(`[engine] option not supported: ${name}`);
      return;
    }
    this.send(`setoption name ${name} value ${value}`);
  }

  private captureSupportedOptions(lines: string[]): void {
    for (const line of lines) {
      if (!line.startsWith('option name ')) continue;
      const match = line.match(/^option name\s+(.+?)\s+type\s+/);
      if (!match) continue;
      this.supportedOptions.add(match[1]);
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Emit raw line for streaming consumers
      this.analysisEmitter.emit('rawline', trimmed);

      // Parse and emit analysis info lines during infinite analysis
      if (this.analyzing && trimmed.startsWith('info') && trimmed.includes(' pv ')) {
        const parsed = this.parseInfoLine(trimmed);
        if (parsed) {
          this.analysisEmitter.emit('info', parsed);
        }
      }

      // Handle queued wait-for-terminator
      if (this.resolveQueue.length > 0) {
        const current = this.resolveQueue[0];
        this.collectedLines.push(trimmed);

        if (trimmed.startsWith(current.terminator)) {
          this.resolveQueue.shift();
          const collected = this.collectedLines;
          this.collectedLines = [];
          current.resolve(collected);
        }
      }
    }
  }

  private parseInfoLine(line: string): AnalysisLine | null {
    const depthMatch = line.match(/\bdepth (\d+)/);
    const multipvMatch = line.match(/\bmultipv (\d+)/);
    const pvMatch = line.match(/ pv (.+)/);

    if (!depthMatch || !pvMatch) return null;

    const depth = parseInt(depthMatch[1], 10);
    const multipv = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
    const pv = pvMatch[1].split(' ');

    let eval_cp = 0;
    let mate: number | null = null;

    const cpMatch = line.match(/score cp (-?\d+)/);
    if (cpMatch) {
      eval_cp = parseInt(cpMatch[1], 10);
    }

    const mateMatch = line.match(/score mate (-?\d+)/);
    if (mateMatch) {
      mate = parseInt(mateMatch[1], 10);
      eval_cp = mate > 0 ? 30000 : -30000;
    }

    return { multipv, depth, eval_cp, mate, pv };
  }
}
