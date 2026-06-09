import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../api/rpc';
import {
  cancelMakingJob,
  evaluatePosition,
  listMakingJobs,
  startMakingJob,
  type MakingJobSnapshot,
  type EngineEvalResult,
} from '../api/backend';
import { createWorkspace, listWorkspaces, saveWorkspaceDraft } from '../api/workspaces';

type SourceKind = 'kifs' | 'books';
type SlotKey = 'correct' | 'incorrect1' | 'incorrect2';

type ChoiceDraft = {
  slotLabel: SlotKey;
  usi: string;
  label: string;
  explanation: string;
  line: string[];
  eval_cp: number | null;
  eval_percent: number | null;
};

type WorkspaceDraft = {
  kifText: string;
  rootSfen: string;
  kifMoves: string[];
  introMoveUsi: string;
  choices: Record<SlotKey, ChoiceDraft>;
  readingLineInputs: Record<SlotKey, string>;
  prompt: string;
  tags: string[];
  displayNo: number | null;
  problemRating: number;
  rootEvalCp: number | null;
  rootEvalPercent: number | null;
  mode: 'next_move' | 'joseki';
  savedAt: string;
  sourceEngineJob?: Record<string, unknown>;
};

type BookFormState = {
  bookFile: 'qhapaq' | 'sanken-shiken';
  count: string;
  minDiff: string;
  maxDiff: string;
};

type KifsFormState = {
  batchSize: string;
  maxProblemsPerGame: string;
  maxScanResultsPerGame: string;
  finalizeDepth: string;
  minDiff: string;
};

type GeneratedDraftProblemRow = {
  id: number;
  created_at: string;
  source_type: string | null;
  source_ref: string | null;
};

type CompareRow = {
  row: number;
  move: string;
  turnBefore: 'b' | 'w';
  bestMoveBefore: string;
  rawBestBefore: number | null;
  senteBestBefore: number | null;
  rawActualSearch: number | null;
  senteActualSearch: number | null;
  pass1Loss: number | null;
  rawAfterMove: number | null;
  senteAfterMove: number | null;
  afterDelta: number | null;
};

type SampleKifuEvalRow = {
  index: number;
  position: string;
  moves: string[];
  beforeBestmove: string;
  beforeEvalCp: number;
  beforePv: string[];
  afterMovesBestmove: string;
  afterMovesEvalCp: number;
  afterMovesPv: string[];
  afterMovesRawTail: string[];
  idealEval?: number | null;
};

const DEFAULT_BOOK_FORM: BookFormState = {
  bookFile: 'qhapaq',
  count: '10',
  minDiff: '200',
  maxDiff: '1000',
};

const BOOK_FILE_OPTIONS: Array<{ value: BookFormState['bookFile']; label: string }> = [
  { value: 'qhapaq', label: 'Qhapaq定跡' },
  { value: 'sanken-shiken', label: '三間四間飛車' },
];

const DEFAULT_KIFS_FORM: KifsFormState = {
  batchSize: '10',
  maxProblemsPerGame: '3',
  maxScanResultsPerGame: '12',
  finalizeDepth: '26',
  minDiff: '200',
};

const DEFAULT_ENGINE_TEST_SFEN =
  'ln1gk2nl/2s3g2/p2ppsbp1/2p3p1p/1r3pPP1/2PBPS3/PP1P1P2P/2GS3R1/LN1K1G1NL b p 1';

const DEFAULT_COMPARE_POSITION =
  'position sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1 moves 2g2f 3c3d 7g7f 4c4d 3i4h 3a3b 2f2e 2b3c 5i6h 3b4c 4i5h 8b4b 5g5f 5a6b 6h7h 6b7b 3g3f 7b8b 6g6f 9a9b 8h7g 8b9a 5h6g 7a8b 7h8h 6a7a 2i3g 4a5b 9i9h 4c5d 6i7h 6c6d 8h9i 6d6e 6f6e 5d6e P*6f 6e7d 7i8h 5b6b 1g1f 4d4e 4h5g 3d3e 2h2f 3c4d 2e2d 2c2d 2f2d 4b2b 2d4d 3e3f 3g4e 3f3g+ 4d4a+ 2b2h+ B*5e 2h7h 6g6h 7h7g 6h7g 3g4g 4e5c+ 6b5c 4a4g N*8e 7g7h B*6i 4g3h G*4g 3h6h 6i5h+ R*5a 4g5g 6h5h 5g5h 5a5c+ 5h5g G*7i P*6g 5e4f R*5h B*3f P*4g 5c5a S*6b 3f8a+ 9a8a 5a2a 6g6h+ 7h6h 5g6h 7i6h 5h5f+ N*6d P*6a G*5b 7d6c 5b6a 7a6a 2a6a G*7a G*7b 8a9a 7b7a 8b7a N*7e G*7b 7e6c 6b6c 6d7b+';

const SAMPLE_KIFU_POSITIONS = [
  'position sfen ln1g3Bl/1ks3g2/6n2/ppppp1ppp/5r3/P1P1PpP1P/1P1P1S3/2KGG2R1/LNS5L b Sbn2p 1',
  'position sfen ln1g4l/1ks6/9/pppp+B1ppp/7n1/P1P1PrP1P/1P1Pp4/2KGG2R1/LNS5L b GS2Pbsnp 1',
];

const SAMPLE_KIFU_IDEALS: number[] = [554, 393];

const MakingEngineCreator: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [bookForm, setBookForm] = useState<BookFormState>(DEFAULT_BOOK_FORM);
  const [kifsForm, setKifsForm] = useState<KifsFormState>(DEFAULT_KIFS_FORM);
  const [jobs, setJobs] = useState<MakingJobSnapshot[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testSfen, setTestSfen] = useState(DEFAULT_ENGINE_TEST_SFEN);
  const [testDepth, setTestDepth] = useState('29');
  const [testResult, setTestResult] = useState<EngineEvalResult | null>(null);
  const [testingEngine, setTestingEngine] = useState(false);
  const [comparePosition, setComparePosition] = useState(DEFAULT_COMPARE_POSITION);
  const [compareDepth, setCompareDepth] = useState('16');
  const [compareStartRow, setCompareStartRow] = useState('40');
  const [compareEndRow, setCompareEndRow] = useState('100');
  const [compareRows, setCompareRows] = useState<CompareRow[]>([]);
  const [comparingKifu, setComparingKifu] = useState(false);
  const [sampleKifuDepth, setSampleKifuDepth] = useState('26');
  const [sampleKifuRows, setSampleKifuRows] = useState<SampleKifuEvalRow[]>([]);
  const [testingSampleKifus, setTestingSampleKifus] = useState(false);
  const importedJobIdsRef = useRef<Set<string>>(new Set());
  const hydratedInitialJobsRef = useRef(false);

  const source = useMemo<SourceKind>(() => {
    const raw = searchParams.get('source');
    return raw === 'kifs' ? 'kifs' : 'books';
  }, [searchParams]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const refreshJobs = async () => {
    try {
      const rows = await listMakingJobs();
      if (!hydratedInitialJobsRef.current) {
        for (const row of rows) {
          if (row.status !== 'queued' && row.status !== 'running') {
            importedJobIdsRef.current.add(row.id);
          }
        }
        hydratedInitialJobsRef.current = true;
      }
      setJobs(rows);
      setSelectedJobId((current) => current ?? rows[0]?.id ?? null);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'ジョブ一覧の取得に失敗しました');
    }
  };

  useEffect(() => {
    void refreshJobs();
  }, []);

  useEffect(() => {
    if (!selectedJob) return;
    if (selectedJob.status !== 'queued' && selectedJob.status !== 'running') return;

    const timer = window.setInterval(() => {
      void refreshJobs();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedJob]);

  useEffect(() => {
    if (!selectedJob) return;
    if (selectedJob.status !== 'completed') return;
    if (importedJobIdsRef.current.has(selectedJob.id)) return;

    importedJobIdsRef.current.add(selectedJob.id);
    void (async () => {
      try {
        if (selectedJob.kind === 'book') {
          const imported = await importBookJobResult(selectedJob);
          setMessage(`booksジョブ完了。${imported}件を下書き一覧に追加しました。`);
        } else {
          const imported = await importKifsJobResult(selectedJob);
          setMessage(`kifsジョブ完了。${imported}件を下書き一覧に追加しました。`);
        }
      } catch (nextError: any) {
        setError(nextError?.message ?? 'ジョブ完了後の取り込みに失敗しました');
      }
    })();
  }, [selectedJob]);

  const runJob = async () => {
    setStarting(true);
    setError('');
    setMessage('');
    try {
      if (source === 'books') {
        const payload = buildBookPayload(bookForm);
        const job = await startMakingJob(payload);
        setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
        setSelectedJobId(job.id);
      } else {
        const job = await startMakingJob({
          kind: 'kifs',
          settings: buildKifsPayload(kifsForm),
        });
        setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
        setSelectedJobId(job.id);
      }
    } catch (nextError: any) {
      setError(nextError?.message ?? 'ジョブの開始に失敗しました');
    } finally {
      setStarting(false);
    }
  };

  const runCancel = async () => {
    if (!selectedJob) return;
    try {
      const job = await cancelMakingJob(selectedJob.id);
      setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)]);
      setSelectedJobId(job.id);
      setMessage(`ジョブ ${job.id} をキャンセルしました。`);
    } catch (nextError: any) {
      setError(nextError?.message ?? 'キャンセルに失敗しました');
    }
  };

  const runEngineTest = async () => {
    setTestingEngine(true);
    setError('');
    setMessage('');
    setTestResult(null);
    try {
      const depth = parseRequiredInt(testDepth, 'depth', 1);
      const result = await evaluatePosition(testSfen.trim(), [], {
        depth,
        multipv: 1,
        newGame: true,
      });
      setTestResult(result);
      setMessage('エンジン検証が完了しました。');
    } catch (nextError: any) {
      setError(nextError?.message ?? 'エンジン検証に失敗しました');
    } finally {
      setTestingEngine(false);
    }
  };

  const runKifuCompare = async () => {
    setComparingKifu(true);
    setError('');
    setMessage('');
    setCompareRows([]);
    try {
      const parsed = parsePositionCommand(comparePosition);
      const depth = parseRequiredInt(compareDepth, 'depth', 1);
      const startRow = parseRequiredInt(compareStartRow, 'startRow', 1);
      const endRow = Math.min(parseRequiredInt(compareEndRow, 'endRow', startRow), parsed.moves.length);
      const initialTurn = getInitialTurn(parsed.initialSfen);
      const rows: CompareRow[] = [];
      let previousAfterSente: number | null = null;

      const startEval = await evaluatePosition(parsed.initialSfen, [], { depth });
      previousAfterSente = normalizeCpToSente(startEval.eval_cp, initialTurn);

      for (let row = startRow; row <= endRow; row += 1) {
        const move = parsed.moves[row - 1];
        if (!move) break;
        const beforeMoves = parsed.moves.slice(0, row - 1);
        const afterMoves = parsed.moves.slice(0, row);
        const turnBefore = turnAfterPlies(initialTurn, row - 1);
        const turnAfter = turnAfterPlies(initialTurn, row);

        const bestBefore = await evaluatePosition(parsed.initialSfen, beforeMoves, { depth });
        const actualSearch = await evaluatePosition(parsed.initialSfen, beforeMoves, {
          depth,
          searchMoves: [move],
        });
        const afterMove = await evaluatePosition(parsed.initialSfen, afterMoves, { depth });

        const senteBestBefore = normalizeCpToSente(bestBefore.eval_cp, turnBefore);
        const senteActualSearch = normalizeCpToSente(actualSearch.eval_cp, turnBefore);
        const senteAfterMove = normalizeCpToSente(afterMove.eval_cp, turnAfter);
        rows.push({
          row,
          move,
          turnBefore,
          bestMoveBefore: bestBefore.bestmove ?? bestBefore.pv[0] ?? '',
          rawBestBefore: bestBefore.eval_cp,
          senteBestBefore,
          rawActualSearch: actualSearch.eval_cp,
          senteActualSearch,
          pass1Loss: absLossFromBest(senteBestBefore, senteActualSearch, turnBefore),
          rawAfterMove: afterMove.eval_cp,
          senteAfterMove,
          afterDelta: senteAfterMove == null || previousAfterSente == null ? null : senteAfterMove - previousAfterSente,
        });
        setCompareRows([...rows]);
        previousAfterSente = senteAfterMove;
      }
      setMessage('棋譜比較が完了しました。');
    } catch (nextError: any) {
      setError(nextError?.message ?? '棋譜比較に失敗しました');
    } finally {
      setComparingKifu(false);
    }
  };

  const runSampleKifuEngineTest = async () => {
    setTestingSampleKifus(true);
    setError('');
    setMessage('');
    setSampleKifuRows([]);
    try {
      const depth = parseRequiredInt(sampleKifuDepth, 'depth', 1);
      const rows: SampleKifuEvalRow[] = [];

      for (let index = 0; index < SAMPLE_KIFU_POSITIONS.length; index += 1) {
        const parsed = parsePositionCommand(SAMPLE_KIFU_POSITIONS[index]);
        const before = await evaluatePosition(parsed.initialSfen, [], {
          depth,
          multipv: 1,
          newGame: true,
        });
        const afterMoves = await evaluatePosition(parsed.initialSfen, parsed.moves, {
          depth,
          multipv: 1,
          newGame: true,
        });

        rows.push({
          index: index + 1,
          position: SAMPLE_KIFU_POSITIONS[index],
          idealEval: SAMPLE_KIFU_IDEALS[index] ?? null,
          moves: parsed.moves,
          beforeBestmove: before.bestmove ?? before.pv[0] ?? '',
          beforeEvalCp: before.eval_cp,
          beforePv: before.pv,
          afterMovesBestmove: afterMoves.bestmove ?? afterMoves.pv[0] ?? '',
          afterMovesEvalCp: afterMoves.eval_cp,
          afterMovesPv: afterMoves.pv,
          afterMovesRawTail: afterMoves.rawLines?.slice(-4) ?? [],
        });
        setSampleKifuRows([...rows]);
      }

      setMessage('kifus 検証局面の評価が完了しました。');
    } catch (nextError: any) {
      setError(nextError?.message ?? 'kifus 検証局面の評価に失敗しました');
    } finally {
      setTestingSampleKifus(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${source === 'books' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          onClick={() => setSearchParams({ source: 'books' })}
        >
          booksから作問
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${source === 'kifs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          onClick={() => setSearchParams({ source: 'kifs' })}
        >
          kifsから作問
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-slate-900">実行設定</h3>

          {source === 'books' ? (
            <BookSettingsForm
              value={bookForm}
              onChange={setBookForm}
            />
          ) : (
            <KifsSettingsForm value={kifsForm} onChange={setKifsForm} />
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              onClick={runJob}
              disabled={starting}
            >
              {starting ? '開始中...' : 'ジョブ開始'}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => void refreshJobs()}
            >
              更新
            </button>
            <button
              type="button"
              className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              onClick={runCancel}
              disabled={!selectedJob || (selectedJob.status !== 'queued' && selectedJob.status !== 'running')}
            >
              キャンセル
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-slate-900">ジョブ履歴</h3>

          <div className="max-h-[280px] space-y-2 overflow-y-auto">
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={`w-full rounded-lg border px-3 py-2 text-left ${selectedJobId === job.id ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-xs text-slate-700">{job.id}</div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${jobStatusClass(job.status)}`}>
                    {job.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {job.kind} / {job.step}
                </div>
              </button>
            ))}
            {jobs.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                ジョブはまだありません。
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">kifus エンジン検証</h3>
            <p className="mt-1 text-sm text-slate-600">
              サンプル2局面を、エンジンサーバーの共通設定で検証します。
            </p>
          </div>
          <div className="flex items-end gap-2">
            <FieldInput label="depth" value={sampleKifuDepth} onChange={setSampleKifuDepth} />
            <button
              type="button"
              className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              onClick={runSampleKifuEngineTest}
              disabled={testingSampleKifus}
            >
              {testingSampleKifus ? '検証中...' : '2局面を検証'}
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
                <tr>
                <th className="border-b border-slate-200 px-2 py-2">#</th>
                <th className="border-b border-slate-200 px-2 py-2">SFEN</th>
                <th className="border-b border-slate-200 px-2 py-2">理想</th>
                <th className="border-b border-slate-200 px-2 py-2">moves</th>
                <th className="border-b border-slate-200 px-2 py-2">before best</th>
                <th className="border-b border-slate-200 px-2 py-2">before eval</th>
                <th className="border-b border-slate-200 px-2 py-2">after moves eval</th>
                <th className="border-b border-slate-200 px-2 py-2">after moves best / pv</th>
                <th className="border-b border-slate-200 px-2 py-2">raw tail</th>
              </tr>
            </thead>
            <tbody>
              {sampleKifuRows.map((row) => (
                <tr key={row.index} className="align-top">
                  <td className="border-b border-slate-100 px-2 py-2 font-mono text-xs">{row.index}</td>
                  <td className="max-w-[320px] break-all border-b border-slate-100 px-2 py-2 font-mono text-xs">
                    {row.position}
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 font-mono text-xs">{row.idealEval ?? '-'}</td>
                  <td className="border-b border-slate-100 px-2 py-2 font-mono text-xs">{row.moves.join(' ') || '-'}</td>
                  <td className="border-b border-slate-100 px-2 py-2 font-mono text-xs">{row.beforeBestmove || '-'}</td>
                  <td className="border-b border-slate-100 px-2 py-2 font-mono text-xs">{row.beforeEvalCp}</td>
                  <td className="border-b border-slate-100 px-2 py-2 font-mono text-xs">{row.afterMovesEvalCp}</td>
                  <td className="border-b border-slate-100 px-2 py-2 font-mono text-xs">
                    {row.afterMovesBestmove || '-'}
                    {row.afterMovesPv.length > 0 ? ` / ${row.afterMovesPv.join(' ')}` : ''}
                  </td>
                  <td className="border-b border-slate-100 px-2 py-2 font-mono text-xs">{row.afterMovesRawTail.join(' | ') || '-'}</td>
                </tr>
              ))}
              {sampleKifuRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-sm text-slate-500" colSpan={8}>
                    まだ検証していません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-base font-semibold text-slate-900">進捗詳細</h3>

        {selectedJob ? (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-4">
              <Info label="job id" value={selectedJob.id} mono />
              <Info label="kind" value={selectedJob.kind} />
              <Info label="status" value={selectedJob.status} />
              <Info label="step" value={selectedJob.step} />
              <Info label="createdAt" value={formatDate(selectedJob.createdAt)} />
              <Info label="startedAt" value={selectedJob.startedAt ? formatDate(selectedJob.startedAt) : '-'} />
              <Info label="finishedAt" value={selectedJob.finishedAt ? formatDate(selectedJob.finishedAt) : '-'} />
              <Info label="error" value={selectedJob.error ?? '-'} />
            </div>

            {selectedJob.result?.notes && selectedJob.result.notes.length > 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {selectedJob.result.notes.map((note, index) => (
                  <div key={`${note}-${index}`}>{note}</div>
                ))}
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-200 bg-slate-950 p-3">
              <div className="mb-2 text-xs font-semibold text-slate-300">log</div>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-slate-100">
                {selectedJob.logs.length > 0 ? selectedJob.logs.join('\n') : '(no logs)'}
              </pre>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
            ジョブを選択してください。
          </div>
        )}
      </section>
    </div>
  );
};

function BookSettingsForm({
  value,
  onChange,
}: {
  value: BookFormState;
  onChange: React.Dispatch<React.SetStateAction<BookFormState>>;
}) {
  const update = <K extends keyof BookFormState>(key: K, next: BookFormState[K]) => {
    onChange((prev) => ({ ...prev, [key]: next }));
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <FieldSelect
        label="定跡ファイル"
        value={value.bookFile}
        options={BOOK_FILE_OPTIONS}
        onChange={(next) => update('bookFile', next as BookFormState['bookFile'])}
      />
      <FieldInput label="count" value={value.count} onChange={(next) => update('count', next)} />
      <FieldInput label="minDiff" value={value.minDiff} onChange={(next) => update('minDiff', next)} />
      <FieldInput label="maxDiff" value={value.maxDiff} onChange={(next) => update('maxDiff', next)} />
    </div>
  );
}

function KifsSettingsForm({
  value,
  onChange,
}: {
  value: KifsFormState;
  onChange: React.Dispatch<React.SetStateAction<KifsFormState>>;
}) {
  const update = <K extends keyof KifsFormState>(key: K, next: KifsFormState[K]) => {
    onChange((prev) => ({ ...prev, [key]: next }));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-xs font-semibold text-slate-700">kifusから問題化（batchGenerate）</div>
        <div className="grid gap-2 md:grid-cols-2">
          <FieldInput label="count (claim件数)" value={value.batchSize} onChange={(next) => update('batchSize', next)} />
          <FieldInput label="maxProblemsPerGame" value={value.maxProblemsPerGame} onChange={(next) => update('maxProblemsPerGame', next)} />
          <FieldInput label="maxScanResultsPerGame" value={value.maxScanResultsPerGame} onChange={(next) => update('maxScanResultsPerGame', next)} />
          <FieldInput label="finalizeDepth" value={value.finalizeDepth} onChange={(next) => update('finalizeDepth', next)} />
          <FieldInput label="minDiff" value={value.minDiff} onChange={(next) => update('minDiff', next)} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        batchGenerate 完了後、ジョブ開始〜終了時刻の範囲で作成された making_draft_problems を確認し、
        下書き一覧に反映します。
      </div>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-600">{label}</span>
      <input
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function FieldSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-600">{label}</span>
      <select
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Info({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-sm text-slate-900 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}

function jobStatusClass(status: MakingJobSnapshot['status']): string {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'failed') return 'bg-rose-100 text-rose-700';
  if (status === 'cancelled') return 'bg-slate-200 text-slate-700';
  if (status === 'running') return 'bg-sky-100 text-sky-700';
  return 'bg-amber-100 text-amber-700';
}

function parseRequiredInt(raw: string, label: string, min: number): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < min) {
    throw new Error(`${label} は ${min} 以上の整数で指定してください`);
  }
  return parsed;
}

function buildBookPayload(value: BookFormState) {
  const minDiff = parseRequiredInt(value.minDiff, 'minDiff', 1);
  const maxDiff = parseRequiredInt(value.maxDiff, 'maxDiff', 1);
  if (maxDiff < minDiff) {
    throw new Error('maxDiff は minDiff 以上で指定してください');
  }

  return {
    kind: 'book' as const,
    settings: {
      bookFile: value.bookFile,
      count: parseRequiredInt(value.count, 'count', 1),
      minDiff,
      maxDiff,
    },
  };
}

function buildKifsPayload(value: KifsFormState) {
  return {
    runGenerateKifus: false,
    runBatchGenerate: true,
    batchSize: parseRequiredInt(value.batchSize, 'batchSize', 1),
    maxProblemsPerGame: parseRequiredInt(value.maxProblemsPerGame, 'maxProblemsPerGame', 1),
    maxScanResultsPerGame: parseRequiredInt(value.maxScanResultsPerGame, 'maxScanResultsPerGame', 1),
    finalizeDepth: parseRequiredInt(value.finalizeDepth, 'finalizeDepth', 26),
    minDiff: parseRequiredInt(value.minDiff, 'minDiff', 1),
  };
}

function getNextWorkspaceNumber(names: string[]): number {
  return names.reduce((maxNo, name) => {
    const match = name.match(/^#(\d+)\b/);
    if (!match) return maxNo;
    const num = Number.parseInt(match[1], 10);
    return Number.isNaN(num) ? maxNo : Math.max(maxNo, num);
  }, 0) + 1;
}

function buildAutoWorkspaceName(nextNumber: number, suffix: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `#${nextNumber} ${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${suffix}`;
}

function parsePositionCommand(command: string): { initialSfen: string; moves: string[] } {
  const trimmed = command.trim();
  const prefix = 'position sfen ';
  if (!trimmed.startsWith(prefix)) {
    throw new Error('position は "position sfen ..." 形式で入力してください');
  }
  const body = trimmed.slice(prefix.length);
  const marker = ' moves ';
  const markerIndex = body.indexOf(marker);
  if (markerIndex < 0) {
    return { initialSfen: body.trim(), moves: [] };
  }
  return {
    initialSfen: body.slice(0, markerIndex).trim(),
    moves: body.slice(markerIndex + marker.length).trim().split(/\s+/).filter(Boolean),
  };
}

function getInitialTurn(initialSfen: string): 'b' | 'w' {
  const turn = initialSfen.trim().split(/\s+/)[1];
  if (turn !== 'b' && turn !== 'w') {
    throw new Error('SFEN の手番が不正です');
  }
  return turn;
}

function turnAfterPlies(initialTurn: 'b' | 'w', plies: number): 'b' | 'w' {
  return plies % 2 === 0 ? initialTurn : initialTurn === 'b' ? 'w' : 'b';
}

function normalizeCpToSente(cp: number | null, turn: 'b' | 'w'): number | null {
  if (cp == null) return null;
  return turn === 'b' ? cp : -cp;
}

function absLossFromBest(bestSente: number | null, actualSente: number | null, turn: 'b' | 'w'): number | null {
  if (bestSente == null || actualSente == null) return null;
  const signed = turn === 'b' ? bestSente - actualSente : actualSente - bestSente;
  return Math.abs(signed);
}

function formatMaybeNumber(value: number | null): string {
  return value == null ? '-' : String(value);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP');
}

function emptyChoice(slot: SlotKey): ChoiceDraft {
  return {
    slotLabel: slot,
    usi: '',
    label: '',
    explanation: '',
    line: [],
    eval_cp: null,
    eval_percent: null,
  };
}

function toChoiceDraft(
  slot: SlotKey,
  source: Partial<{
    usi: unknown;
    label: unknown;
    explanation: unknown;
    line: unknown;
    eval_cp: unknown;
    eval_percent: unknown;
  }> | null | undefined,
): ChoiceDraft {
  const line = Array.isArray(source?.line)
    ? source!.line.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    slotLabel: slot,
    usi: typeof source?.usi === 'string' ? source.usi : '',
    label: typeof source?.label === 'string' ? source.label : '',
    explanation: typeof source?.explanation === 'string' ? source.explanation : '',
    line,
    eval_cp: typeof source?.eval_cp === 'number' ? source.eval_cp : null,
    eval_percent: typeof source?.eval_percent === 'number' ? source.eval_percent : null,
  };
}

function normalizeWorkspaceDraft(raw: Record<string, unknown>, modeFallback: 'next_move' | 'joseki'): WorkspaceDraft {
  const introMovesUsi = Array.isArray(raw.introMovesUsi)
    ? raw.introMovesUsi.filter((item): item is string => typeof item === 'string')
    : [];
  const introMoveUsi =
    typeof raw.introMoveUsi === 'string' ? raw.introMoveUsi : introMovesUsi[introMovesUsi.length - 1] ?? '';

  const rawChoices = raw.choices as Record<string, unknown> | undefined;

  return {
    kifText: typeof raw.kifText === 'string' ? raw.kifText : '',
    rootSfen: typeof raw.rootSfen === 'string' ? raw.rootSfen : '',
    kifMoves: Array.isArray(raw.kifMoves)
      ? raw.kifMoves.filter((item): item is string => typeof item === 'string')
      : introMovesUsi,
    introMoveUsi,
    choices: {
      correct: toChoiceDraft('correct', rawChoices?.correct as Record<string, unknown>),
      incorrect1: toChoiceDraft('incorrect1', rawChoices?.incorrect1 as Record<string, unknown>),
      incorrect2: toChoiceDraft('incorrect2', rawChoices?.incorrect2 as Record<string, unknown>),
    },
    readingLineInputs: {
      correct: '',
      incorrect1: '',
      incorrect2: '',
    },
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '最善手を選んでください',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((item): item is string => typeof item === 'string') : [],
    displayNo: typeof raw.displayNo === 'number' ? raw.displayNo : null,
    problemRating: typeof raw.problemRating === 'number' ? raw.problemRating : 1500,
    rootEvalCp: typeof raw.rootEvalCp === 'number' ? raw.rootEvalCp : null,
    rootEvalPercent: typeof raw.rootEvalPercent === 'number' ? raw.rootEvalPercent : null,
    mode: raw.mode === 'joseki' ? 'joseki' : modeFallback,
    savedAt: new Date().toISOString(),
  };
}

async function importBookJobResult(job: MakingJobSnapshot): Promise<number> {
  const records = job.result?.generatedRecords ?? [];
  if (records.length === 0) return 0;

  const workspaces = await listWorkspaces();
  let nextNo = getNextWorkspaceNumber(workspaces.map((workspace) => workspace.name));
  let importedCount = 0;

  for (const record of records) {
    const preferredName = record.name?.trim();
    let workspace;
    if (preferredName) {
      try {
        workspace = await createWorkspace(preferredName);
      } catch {
        workspace = await createWorkspace(buildAutoWorkspaceName(nextNo, 'books'));
        nextNo += 1;
      }
    } else {
      workspace = await createWorkspace(buildAutoWorkspaceName(nextNo, 'books'));
      nextNo += 1;
    }

    const draft = normalizeWorkspaceDraft(record.draft ?? {}, 'next_move');
    draft.sourceEngineJob = {
      kind: 'book',
      jobId: job.id,
      createdAt: job.createdAt,
    };
    await saveWorkspaceDraft(workspace.id, draft as unknown as Record<string, unknown>);
    importedCount += 1;
  }

  return importedCount;
}

async function importKifsJobResult(job: MakingJobSnapshot): Promise<number> {
  if (!job.result?.notes?.some((note) => note.includes('batchGenerate completed'))) {
    return 0;
  }

  const queryProblems = async (useWindow: boolean): Promise<GeneratedDraftProblemRow[]> => {
    let query = supabase
      .from('making_draft_problems')
      .select('id, created_at, source_type, source_ref')
      .eq('mode', 'next_move')
      .eq('source_type', 'kif_problem_generation')
      .order('id', { ascending: false })
      .limit(300);

    if (useWindow && job.startedAt) {
      const start = new Date(job.startedAt).getTime() - 2 * 60 * 1000;
      const endBase = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
      const end = endBase + 2 * 60 * 1000;
      query = query.gte('created_at', new Date(start).toISOString()).lte('created_at', new Date(end).toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as GeneratedDraftProblemRow[];
  };

  const problems = await queryProblems(true);
  if (problems.length > 0) {
    return problems.length;
  }

  const fallbackProblems = await queryProblems(false);
  return fallbackProblems.length;
}

export default MakingEngineCreator;
