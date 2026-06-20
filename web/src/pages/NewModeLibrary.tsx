import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listProductionChoicesByProblemIds, listProductionProblems } from '../api/production';
import ShogiBoardPreview from '../components/ShogiBoardPreview';
import type { ProductionChoice, ProductionProblem } from '../types/production';

const UNTAGGED_BOOK = 'タグなし';
const BOOK_COLORS = [
  'from-sky-600 to-cyan-500',
  'from-emerald-600 to-teal-500',
  'from-rose-600 to-pink-500',
  'from-amber-600 to-orange-500',
  'from-indigo-600 to-blue-500',
  'from-slate-700 to-slate-500',
  'from-lime-600 to-green-500',
  'from-fuchsia-600 to-violet-500',
];

type Book = {
  tag: string;
  problems: ProductionProblem[];
};

const NewModeLibrary: React.FC = () => {
  const navigate = useNavigate();
  const [problems, setProblems] = useState<ProductionProblem[]>([]);
  const [choices, setChoices] = useState<ProductionChoice[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await listProductionProblems({ mode: 'new_mode', limit: 2000 });
      const choiceRows = await listProductionChoicesByProblemIds(rows.map((row) => row.problemId), 'new_mode');
      setProblems(rows);
      setChoices(choiceRows);
    } catch (nextError: any) {
      setError(nextError?.message ?? '新モード問題の読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const books = useMemo<Book[]>(() => {
    const map = new Map<string, ProductionProblem[]>();
    for (const problem of problems) {
      const tags = problem.tags.length > 0 ? problem.tags : [UNTAGGED_BOOK];
      for (const tag of tags) {
        const current = map.get(tag) ?? [];
        current.push(problem);
        map.set(tag, current);
      }
    }

    return Array.from(map.entries())
      .map(([tag, taggedProblems]) => ({
        tag,
        problems: taggedProblems.sort((a, b) => {
          const left = a.displayNo ?? a.problemId;
          const right = b.displayNo ?? b.problemId;
          return left - right;
        }),
      }))
      .sort((a, b) => {
        if (a.tag === UNTAGGED_BOOK) return 1;
        if (b.tag === UNTAGGED_BOOK) return -1;
        return a.tag.localeCompare(b.tag, 'ja');
      });
  }, [problems]);

  const selectedBook = useMemo(
    () => books.find((book) => book.tag === selectedTag) ?? null,
    [books, selectedTag],
  );

  const correctChoiceByProblemId = useMemo(() => {
    const map = new Map<number, ProductionChoice>();
    for (const problem of problems) {
      const correct = choices.find(
        (choice) => choice.problem_id === problem.problemId && choice.choice_id === problem.correctChoiceId,
      );
      if (correct) map.set(problem.problemId, correct);
    }
    return map;
  }, [choices, problems]);

  const openProblem = (problem: ProductionProblem) => {
    navigate(`/paste-problem?workspace=${problem.problemId}`);
  };

  return (
    <div className="min-h-[calc(100vh-106px)] bg-slate-50 px-4 py-4">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">新モード</h1>
            <div className="mt-1 text-sm text-slate-600">
              {selectedBook
                ? `${selectedBook.tag} / ${selectedBook.problems.length.toLocaleString('ja-JP')} 問`
                : `${books.length.toLocaleString('ja-JP')} 冊 / ${problems.length.toLocaleString('ja-JP')} 問`}
            </div>
          </div>
          <div className="flex gap-2">
            {selectedBook ? (
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                本棚に戻る
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              className="h-9 rounded-md border border-sky-500 bg-sky-500 px-3 text-sm font-semibold text-white hover:bg-sky-600"
            >
              更新
            </button>
          </div>
        </header>

        {loading ? (
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            読み込み中...
          </div>
        ) : null}
        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        {!loading && !error && !selectedBook ? (
          books.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
              新モードの下書きがありません。
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {books.map((book, index) => (
                <button
                  key={book.tag}
                  type="button"
                  onClick={() => setSelectedTag(book.tag)}
                  className="group flex min-h-44 overflow-hidden rounded-md border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                >
                  <div className={`w-12 bg-gradient-to-b ${BOOK_COLORS[index % BOOK_COLORS.length]}`} />
                  <div className="flex min-w-0 flex-1 flex-col justify-between p-4">
                    <div>
                      <div className="line-clamp-2 text-xl font-semibold text-slate-950">{book.tag}</div>
                      <div className="mt-2 text-sm text-slate-500">
                        {book.problems.length.toLocaleString('ja-JP')} 問
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1.5 text-xs text-slate-500">
                      {book.problems.slice(0, 4).map((problem) => (
                        <span key={problem.problemId} className="rounded bg-slate-100 px-2 py-1">
                          ID {problem.problemId}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : null}

        {!loading && !error && selectedBook ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {selectedBook.problems.map((problem) => (
              <button
                key={problem.problemId}
                type="button"
                onClick={() => openProblem(problem)}
                className="rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-sky-300 hover:bg-sky-50/40 hover:shadow-md"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">
                      ID {problem.problemId}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      No.{problem.displayNo ?? '-'}
                    </div>
                  </div>
                  <div className="min-w-0 rounded bg-emerald-50 px-2 py-1 text-right text-xs font-semibold text-emerald-700">
                    {correctChoiceByProblemId.get(problem.problemId)?.label || '答え未設定'}
                  </div>
                </div>

                <ShogiBoardPreview
                  sfen={problem.rootSfen}
                  maxWidth={252}
                  errorText="盤面を表示できません"
                  errorMinHeight={180}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default NewModeLibrary;
