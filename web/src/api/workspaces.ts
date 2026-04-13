import { supabase } from '../lib/supabase';

export interface Workspace {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  draft: Record<string, unknown> | null;
}

/** List all workspaces ordered by most recently updated */
export async function listWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Create a new workspace */
export async function createWorkspace(name: string): Promise<Workspace> {
  const { data, error } = await supabase
    .from('workspaces')
    .insert({ name, draft: null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Update workspace name */
export async function renameWorkspace(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('workspaces')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Save draft data to a workspace */
export async function saveWorkspaceDraft(
  id: string,
  draft: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('workspaces')
    .update({ draft, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Get a single workspace by id */
export async function getWorkspace(id: string): Promise<Workspace | null> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/** Delete a workspace */
export async function deleteWorkspace(id: string): Promise<void> {
  const { error } = await supabase
    .from('workspaces')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
