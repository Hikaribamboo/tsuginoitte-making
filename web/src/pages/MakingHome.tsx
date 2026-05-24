import React from 'react';
import { Link } from 'react-router-dom';

const CARDS = [
  {
    to: '/image-position',
    title: '画像から作問',
    description: '画像認識で局面を作って、そのまま下書きへ進みます。',
  },
  {
    to: '/making/engine?source=kifs',
    title: 'kifsから作問',
    description: 'auto-make-tsumeshogi を実行して問題を生成します。',
  },
  {
    to: '/making/engine?source=books',
    title: 'booksから作問',
    description: 'tsuginoitte-draft-making を実行して問題を生成します。',
  },
  {
    to: '/making/kifus',
    title: 'kifs生成',
    description: '自己対局棋譜の生成とkifus集計を確認します。',
  },
];

const MakingHome: React.FC = () => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold text-slate-900">作問スタジオ</h2>
        <p className="mt-1 text-sm text-slate-600">作問フローをここから開始します。</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
    </div>
  );
};

export default MakingHome;
