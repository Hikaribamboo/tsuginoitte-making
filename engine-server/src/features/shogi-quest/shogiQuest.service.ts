const HISTORY_ENDPOINT = process.env.SHOGI_QUEST_HISTORY_ENDPOINT?.trim()
  || 'https://c-loft.com/shogi/quest/history/';
const GAME_ENDPOINT = process.env.SHOGI_QUEST_GAME_ENDPOINT?.trim()
  || 'http://questgames.net/game/';
const REQUEST_TIMEOUT_MS = 20_000;

export type ShogiQuestMode = '10min' | '5min';

type QuestHistoryPlayer = {
  id?: string;
  name?: string;
  oldR?: number;
  oldD?: number;
  avatar?: string;
};

type QuestHistoryGame = {
  id?: string;
  created?: string;
  players?: QuestHistoryPlayer[];
  finalStatus?: string;
  length?: number;
  handicap?: string;
};

type QuestHistoryResponse = {
  userId?: string;
  gtype?: string;
  games?: QuestHistoryGame[];
};

export type ShogiQuestFetchedGame = {
  gameId: string;
  history: QuestHistoryGame;
  rawGame: Record<string, unknown>;
};

export type ShogiQuestFetchFailure = {
  gameId: string | null;
  stage: 'fetch';
  message: string;
  history?: QuestHistoryGame;
};

export type ShogiQuestFetchResult = {
  username: string;
  mode: ShogiQuestMode;
  requestedCount: number;
  fetchedAt: string;
  games: ShogiQuestFetchedGame[];
  errors: ShogiQuestFetchFailure[];
};

function modeToGameType(mode: ShogiQuestMode): 'shogi10' | 'shogi' {
  return mode === '10min' ? 'shogi10' : 'shogi';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'tsuginoitte-making/shogi-quest-import',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGame(history: QuestHistoryGame): Promise<ShogiQuestFetchedGame> {
  const gameId = history.id?.trim();
  if (!gameId) {
    throw new Error('対局IDがありません');
  }

  const rawGame = await fetchJson<Record<string, unknown>>(`${GAME_ENDPOINT}${encodeURIComponent(gameId)}.json`);
  return { gameId, history, rawGame };
}

export async function fetchShogiQuestGames(input: {
  username: string;
  mode: ShogiQuestMode;
  count: number;
}): Promise<ShogiQuestFetchResult> {
  const username = input.username.trim();
  if (!username) throw new Error('将棋クエストのユーザー名を指定してください');
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 50) {
    throw new Error('取得件数は1件以上50件以下で指定してください');
  }
  if (input.mode !== '10min' && input.mode !== '5min') {
    throw new Error('モードは10分または5分を指定してください');
  }

  const fetchedAt = new Date().toISOString();
  const historyUrl = new URL(HISTORY_ENDPOINT);
  historyUrl.searchParams.set('userId', username.toLowerCase());
  historyUrl.searchParams.set('gtype', modeToGameType(input.mode));

  let historyResponse: QuestHistoryResponse;
  try {
    historyResponse = await fetchJson<QuestHistoryResponse>(historyUrl.toString());
  } catch (error) {
    throw new Error(`将棋クエスト対局履歴の取得に失敗しました: ${errorMessage(error)}`);
  }
  const histories = Array.isArray(historyResponse.games)
    ? historyResponse.games.slice(0, input.count)
    : [];

  const games: ShogiQuestFetchedGame[] = [];
  const errors: ShogiQuestFetchFailure[] = [];

  for (const history of histories) {
    try {
      games.push(await fetchGame(history));
    } catch (error) {
      errors.push({
        gameId: history.id?.trim() || null,
        stage: 'fetch',
        message: `棋譜本体の取得に失敗しました: ${errorMessage(error)}`,
        history,
      });
    }
  }

  return {
    username,
    mode: input.mode,
    requestedCount: input.count,
    fetchedAt,
    games,
    errors,
  };
}
