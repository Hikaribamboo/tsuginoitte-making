import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchFavorites, deleteFavorite, listFavoriteIdsWithProblemDraft } from '../api/favorites';
import { AVAILABLE_TAGS } from '../lib/constants';
import MiniBoard from '../components/MiniBoard';
import type { FavoritePosition } from '../types/problem';

const TAG_LABEL_MAP = Object.fromEntries(AVAILABLE_TAGS.map(t => [t.value, t.label]));

const FavoritesList: React.FC = () => {
  const [favorites, setFavorites] = useState<FavoritePosition[]>([]);
  const [draftFavoriteIds, setDraftFavoriteIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchFavorites();
      setFavorites(data);
      const ids = await listFavoriteIdsWithProblemDraft();
      const draftIds = new Set(ids);
      setDraftFavoriteIds(draftIds);
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: number) => {
    if (!window.confirm('この局面を削除しますか？')) return;
    try {
      await deleteFavorite(id);
      setFavorites((prev) => prev.filter((f) => f.id !== id));
      setDraftFavoriteIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleEdit = (fav: FavoritePosition) => {
    navigate('/', {
      state: {
        editId: fav.id,
        tags: fav.tags,
        sfen: fav.root_sfen,
      },
    });
  };

  const handleCreateProblem = (fav: FavoritePosition) => {
    navigate('/problem', {
      state: {
        favorite_id: fav.id,
        root_sfen: fav.root_sfen,
        tags: fav.tags,
        last_move: fav.last_move ?? null,
      },
    });
  };

  if (loading) return <div className="p-10 text-center text-gray-400">読み込み中...</div>;

  return (
    <div className="max-w-[900px]">
      <h2 className="text-lg font-semibold mb-4">お気に入り局面一覧</h2>
      {error && <div className="bg-red-50 border border-red-300 text-red-700 p-3 rounded mb-3">{error}</div>}

      {favorites.length === 0 ? (
        <div className="p-10 text-center text-gray-400">
          保存された局面はありません。局面作成画面から保存してください。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {favorites.map((fav) => (
            <div key={fav.id} className="flex justify-between items-start px-4 py-3 bg-white border border-gray-200 rounded-md gap-4">
              <MiniBoard sfen={fav.root_sfen} size={18} />
              <div className="flex-1 min-w-0">
                {fav.tags && fav.tags.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {fav.tags.map((t) => (
                      <span key={t} className="text-[11px] px-1.5 py-px bg-indigo-100 text-indigo-800 rounded">{TAG_LABEL_MAP[t] ?? t}</span>
                    ))}
                  </div>
                )}
                <div className="font-mono text-[11px] text-gray-500 break-all" title={fav.root_sfen}>
                  {fav.root_sfen.length > 60
                    ? fav.root_sfen.slice(0, 60) + '...'
                    : fav.root_sfen}
                </div>
                <div className="text-[11px] text-gray-400 mt-1">
                  {fav.created_at && new Date(fav.created_at).toLocaleString('ja-JP')}
                </div>
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                <button className="w-[100px] text-xs" onClick={() => handleEdit(fav)}>編集</button>
                <button className="w-[100px] text-xs bg-blue-600 text-white border-blue-600 hover:bg-blue-700" onClick={() => handleCreateProblem(fav)}>
                  {fav.id && draftFavoriteIds.has(fav.id) ? '再開' : '問題作成'}
                </button>
                <button className="w-[100px] text-xs bg-red-600 text-white border-red-600 hover:bg-red-700" onClick={() => handleDelete(fav.id!)}>
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FavoritesList;
