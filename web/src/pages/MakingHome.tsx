import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listDailyProblemCreationCounts, type DailyProblemCreationCount } from '../api/production';

const CARDS = [
  {
    to: '/image-position',
    title: '画像から作問',
    description: '画像認識で局面を作って、そのまま下書きへ進みます。',
  },
  {
    to: '/making/engine?source=kifs',
    title: 'kifsから作問',
    description: 'kifsから次の一手問題を生成します。',
  },
  {
    to: '/making/engine?source=books',
    title: 'booksから作問',
    description: '定跡ファイルから次の一手問題を生成します。',
  },
  {
    to: '/making/kifus',
    title: 'kifs生成',
    description: '自己対局棋譜の生成とkifus集計を確認します。',
  },
];

const MakingHome: React.FC = () => {
  const [dailyCounts, setDailyCounts] = useState<DailyProblemCreationCount[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [countsError, setCountsError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingCounts(true);
    setCountsError('');

    listDailyProblemCreationCounts(20)
      .then((rows) => {
        if (cancelled) return;
        setDailyCounts(rows);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setCountsError(error?.message ?? '作成数の取得に失敗しました');
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingCounts(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(
    () => dailyCounts.reduce(
      (acc, row) => ({
        nextMove: acc.nextMove + row.nextMoveCount,
        joseki: acc.joseki + row.josekiCount,
      }),
      { nextMove: 0, joseki: 0 },
    ),
    [dailyCounts],
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold text-slate-900">作問スタジオ</h2>
        <p className="mt-1 text-sm text-slate-600">作問フローをここから開始します。</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-3 md:grid-cols-2">
          {CARDS.map((card) => (
            <Link
              key={card.title}
              to={card.to}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-white"
            >
              <div className="text-base font-semibold text-slate-900">{card.title}</div>
              <div className="mt-2 text-sm text-slate-600">{card.description}</div>
            </Link>
          ))}
        </div>

        <aside className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">日別作成数</h3>
              <p className="mt-1 text-xs text-slate-600">過去20日間の本番問題作成数です。</p>
            </div>
            <div className="rounded-md bg-white px-2 py-1 text-right text-xs text-slate-600">
              <div>計 {totals.nextMove + totals.joseki}</div>
              <div className="text-[11px]">思考 {totals.nextMove} / 定跡 {totals.joseki}</div>
            </div>
          </div>

          {loadingCounts ? (
            <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">
              読み込み中...
            </div>
          ) : countsError ? (
            <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {countsError}
            </div>
          ) : (
            <div className="mt-4 max-h-[520px] overflow-auto rounded-md border border-slate-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2">日付</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-right">思考</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-right">定跡</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-right">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyCounts.map((row) => (
                    <tr key={row.date}>
                      <td className="border-b border-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
                        {formatDateLabel(row.date)}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono text-xs text-slate-900">
                        {row.nextMoveCount}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono text-xs text-slate-900">
                        {row.josekiCount}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-mono text-xs font-semibold text-slate-900">
                        {row.nextMoveCount + row.josekiCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

function formatDateLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${month}/${day}`;
}

export default MakingHome;
