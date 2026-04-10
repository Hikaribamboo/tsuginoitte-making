import { supabase } from '../lib/supabase';
import type { FavoritePosition } from '../types/problem';

function isMissingLastMoveColumnError(error: any): boolean {
  const msg = String(error?.message ?? '');
  return msg.includes("Could not find the 'last_move' column")
    || msg.includes('schema cache');
}

function withoutLastMove<T extends { last_move?: string | null }>(fav: T): Omit<T, 'last_move'> {
  const { last_move: _ignored, ...rest } = fav;
  return rest;
}

export async function fetchFavorites(): Promise<FavoritePosition[]> {
  const { data, error } = await supabase
    .from('favorite_positions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createFavorite(
  fav: Omit<FavoritePosition, 'id' | 'created_at' | 'updated_at'>,
): Promise<FavoritePosition> {
  let { data, error } = await supabase
    .from('favorite_positions')
    .insert(fav)
    .select()
    .single();
  if (error && isMissingLastMoveColumnError(error) && 'last_move' in fav) {
    const retry = await supabase
      .from('favorite_positions')
      .insert(withoutLastMove(fav))
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  return data;
}

export async function updateFavorite(
  id: number,
  fav: Partial<Omit<FavoritePosition, 'id' | 'created_at' | 'updated_at'>>,
): Promise<FavoritePosition> {
  let { data, error } = await supabase
    .from('favorite_positions')
    .update(fav)
    .eq('id', id)
    .select()
    .single();
  if (error && isMissingLastMoveColumnError(error) && 'last_move' in fav) {
    const retry = await supabase
      .from('favorite_positions')
      .update(withoutLastMove(fav))
      .eq('id', id)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  return data;
}

export async function deleteFavorite(id: number): Promise<void> {
  const { error } = await supabase.from('favorite_positions').delete().eq('id', id);
  if (error) throw error;
}
