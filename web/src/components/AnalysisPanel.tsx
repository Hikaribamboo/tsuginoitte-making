import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { startAnalysisStream, type AnalysisLine } from '../api/engine';
import { pvToJapanese } from '../lib/usi-to-label';
import { parseSfen } from '../lib/sfen';

export interface BestMove {
  from: { row: number; col: number } | null;
  to: { row: number; col: number };
  usi: string;
}

interface AnalysisPanelProps {
  sfen: string;
  onBestMove?: (best: BestMove | null) => void;
  onCandidateMoves?: (moves: BestMove[]) => void;
  headerExtra?: React.ReactNode;
}

function parseBestMove(pv: string[]): BestMove | null {
  if (pv.length === 0) return null;
  const usi = pv[0];
  const isDrop = usi[1] === '*';
  if (isDrop) {
    const file = parseInt(usi[2], 10);
    const rank = usi[3].charCodeAt(0) - 'a'.charCodeAt(0);
    return { from: null, to: { row: rank, col: 9 - file }, usi };
  }
  const fromFile = parseInt(usi[0], 10);
  const fromRank = usi[1].charCodeAt(0) - 'a'.charCodeAt(0);
  const toFile = parseInt(usi[2], 10);
  const toRank = usi[3].charCodeAt(0) - 'a'.charCodeAt(0);
  return {
    from: { row: fromRank, col: 9 - fromFile },
    to: { row: toRank, col: 9 - toFile },
    usi,
  };
}

const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ sfen, onBestMove, onCandidateMoves, headerExtra }) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [lines, setLines] = useState<Map<number, AnalysisLine>>(new Map());
  const [depth, setDepth] = useState(0);
  const [error, setError] = useState('');
  const eventSourceRef = useRef<EventSource | null>(null);
  const sfenRef = useRef(sfen);

  // Keep sfenRef in sync
  useEffect(() => {
    sfenRef.current = sfen;
  }, [sfen]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // When sfen changes while analyzing, restart
  useEffect(() => {
    if (analyzing) {
      stopAnalysis();
      // Small delay then restart
      const timer = setTimeout(() => {
        startAnalysis();
      }, 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sfen]);

  const startAnalysis = useCallback(() => {
    setError('');
    setLines(new Map());
    setDepth(0);
    onBestMove?.(null);
    onCandidateMoves?.([]);

    const es = startAnalysisStream(
      sfenRef.current,
      5,
      (info) => {
        setLines((prev) => {
          const next = new Map(prev);
          next.set(info.multipv, info);
          return next;
        });
        setDepth((prev) => Math.max(prev, info.depth));
      },
      (err) => {
        setError(err);
      },
    );

    eventSourceRef.current = es;
    setAnalyzing(true);
  }, [onBestMove, onCandidateMoves]);

  const stopAnalysis = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setAnalyzing(false);
    setLines(new Map());
    setDepth(0);
    onBestMove?.(null);
    onCandidateMoves?.([]);
  }, [onBestMove, onCandidateMoves]);

  const toggleAnalysis = useCallback(() => {
    if (analyzing) {
      stopAnalysis();
    } else {
      startAnalysis();
    }
  }, [analyzing, startAnalysis, stopAnalysis]);

  const sortedLines = useMemo(
    () => Array.from(lines.values()).sort((a, b) => a.multipv - b.multipv),
    [lines],
  );

  // Engine score is from side-to-move perspective. Convert to sente-fixed perspective.
  const senteSign = useMemo(() => {
    const side = parseSfen(sfen).sideToMove;
    return side === 'sente' ? 1 : -1;
  }, [sfen]);

  // Emit best move arrow
  useEffect(() => {
    const topMoves = sortedLines
      .map((line) => parseBestMove(line.pv))
      .filter((m): m is BestMove => m !== null);

    onCandidateMoves?.(topMoves);
    onBestMove?.(topMoves[0] ?? null);
  }, [sortedLines, onBestMove, onCandidateMoves]);

  return (
    <div className="mt-1 bg-white border border-gray-200 rounded-md px-3 py-2.5 min-w-[300px] max-w-[550px]">
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={toggleAnalysis}
          className={analyzing ? 'bg-red-600 text-white border-red-600 hover:bg-red-700' : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'}
        >
          {analyzing ? '⏹ 検討停止' : '▶ 検討開始'}
        </button>
        {analyzing && <span className="text-xs text-gray-400">深さ: {depth}</span>}
        {headerExtra}
      </div>

      {error && <div className="bg-red-50 border border-red-300 text-red-700 px-2.5 py-1.5 rounded text-xs mb-1.5">{error}</div>}

      {sortedLines.length > 0 && (
        <div className="max-h-[280px] overflow-y-auto">
          <table className="w-full border-collapse text-xs table-fixed">
            <thead>
              <tr>
                <th className="w-7 text-center text-left px-2 py-1 border-b border-gray-200 font-semibold text-gray-500 text-[11px] whitespace-nowrap">#</th>
                <th className="w-20 text-left px-2 py-1 border-b border-gray-200 font-semibold text-gray-500 text-[11px] whitespace-nowrap">評価値</th>
                <th className="text-left px-2 py-1 border-b border-gray-200 font-semibold text-gray-500 text-[11px] whitespace-nowrap">読み筋</th>
              </tr>
            </thead>
            <tbody>
              {sortedLines.map((line) => {
                const jpPv = pvToJapanese(line.pv, sfen, 10);
                const displayCp = line.eval_cp * senteSign;
                const displayMate = line.mate !== null ? line.mate * senteSign : null;
                const isBest = line.multipv === 1;
                return (
                  <tr key={line.multipv}>
                    <td className={`w-7 text-center px-2 py-1 border-b border-gray-100 align-top ${isBest ? 'bg-amber-50 font-medium' : ''}`}>{line.multipv}</td>
                    <td className={`w-20 font-mono whitespace-nowrap px-2 py-1 border-b border-gray-100 align-top ${isBest ? 'bg-amber-50 font-medium' : ''}`}>
                      {displayMate !== null
                        ? `詰${displayMate > 0 ? '+' : ''}${displayMate}`
                        : String(displayCp)}
                    </td>
                    <td className={`max-w-0 px-2 py-1 border-b border-gray-100 align-top ${isBest ? 'bg-amber-50 font-medium' : ''}`}>
                      <div className="overflow-x-auto whitespace-nowrap text-xs pb-0.5">{jpPv.join(' ')}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {analyzing && sortedLines.length === 0 && (
        <div className="text-gray-400 text-[13px] py-2 animate-pulse">計算中...</div>
      )}
    </div>
  );
};

export default AnalysisPanel;
