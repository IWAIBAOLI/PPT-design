import 'server-only';

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

import { createClient as createSupabaseClient } from '@/lib/supabase/server';
import type { Database, Json } from '@/lib/supabase/database.types';
import { requireProjectRoot } from '@/lib/server/local-settings';

const ROOT_DIR = path.resolve(process.cwd(), '..');

export type StorageMode = 'supabase' | 'local';

export interface ProjectRecord {
  id: string;
  created_at: string;
  updated_at: string;
  project_name: string;
  user_prompt?: string | null;
  brief_json?: unknown;
  content_draft?: unknown;
  model_used?: string | null;
  status: 'draft' | 'processing' | 'completed' | 'error' | string;
}

export interface PipelineResultRecord {
  id: string;
  project_id: string;
  step_name: string;
  status: string;
  message?: string | null;
  output?: unknown;
  created_at: string;
}

export interface GeneratedFileRecord {
  id: string;
  project_id: string;
  file_type: string;
  file_name: string;
  storage_path: string;
  file_size: number | null;
  version: number;
  is_current: boolean;
  created_at: string;
}

interface LocalStoreData {
  projects: ProjectRecord[];
  pipeline_results: PipelineResultRecord[];
  generated_files: GeneratedFileRecord[];
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureLocalStore() {
  const generatedProjectsDir = await requireProjectRoot();
  const localStoreDir = path.join(generatedProjectsDir, '.local-store');
  const localStorePath = path.join(localStoreDir, 'db.json');

  await fs.mkdir(localStoreDir, { recursive: true });
  try {
    await fs.access(localStorePath);
  } catch {
    const initialData: LocalStoreData = {
      projects: [],
      pipeline_results: [],
      generated_files: [],
    };
    await fs.writeFile(localStorePath, JSON.stringify(initialData, null, 2), 'utf-8');
  }
}

async function getLocalStorePath() {
  const generatedProjectsDir = await requireProjectRoot();
  return path.join(generatedProjectsDir, '.local-store', 'db.json');
}

export async function getGeneratedProjectsDir() {
  return requireProjectRoot();
}

async function readLocalStore(): Promise<LocalStoreData> {
  await ensureLocalStore();
  const localStorePath = await getLocalStorePath();
  const content = await fs.readFile(localStorePath, 'utf-8');
  return JSON.parse(content) as LocalStoreData;
}

async function writeLocalStore(data: LocalStoreData) {
  await ensureLocalStore();
  const localStorePath = await getLocalStorePath();
  await fs.writeFile(localStorePath, JSON.stringify(data, null, 2), 'utf-8');
}

function isSupabaseNotFoundError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'PGRST116';
}

function getSupabaseErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown Supabase error';
}

function toJsonValue(value: unknown): Json {
  return (value ?? null) as Json;
}

export function getStorageMode(): StorageMode {
  return process.env.USE_SUPABASE_STORAGE === 'true'
    && process.env.NEXT_PUBLIC_SUPABASE_URL
    && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? 'supabase'
    : 'local';
}

export async function listProjects(): Promise<ProjectRecord[]> {
  if (getStorageMode() === 'supabase') {
    const supabase = await createSupabaseClient();
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as ProjectRecord[];
  }

  const store = await readLocalStore();
  return [...store.projects].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getProjectById(id: string): Promise<ProjectRecord | null> {
  if (getStorageMode() === 'supabase') {
    const supabase = await createSupabaseClient();
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (isSupabaseNotFoundError(error)) {
        return null;
      }
      throw new Error(getSupabaseErrorMessage(error));
    }

    return data as ProjectRecord;
  }

  const store = await readLocalStore();
  return store.projects.find((project) => project.id === id) ?? null;
}

export async function upsertProject(input: Partial<ProjectRecord> & { project_name: string; id?: string | null }) {
  if (getStorageMode() === 'supabase') {
    const supabase = await createSupabaseClient();
    const payload: Database['public']['Tables']['projects']['Insert'] = {
      project_name: input.project_name,
      user_prompt: input.user_prompt,
      brief_json: toJsonValue(input.brief_json ?? {}),
      content_draft: toJsonValue(input.content_draft ?? null),
      status: input.status || 'draft',
      model_used: input.model_used,
    };

    const result = input.id
      ? await supabase.from('projects').update(payload).eq('id', input.id).select().single()
      : await supabase.from('projects').insert(payload).select().single();

    if (result.error) {
      throw new Error(result.error.message);
    }

    return result.data as ProjectRecord;
  }

  const store = await readLocalStore();
  const timestamp = nowIso();

  if (input.id) {
    const index = store.projects.findIndex((project) => project.id === input.id);
    if (index === -1) {
      throw new Error(`Project not found: ${input.id}`);
    }

    store.projects[index] = {
      ...store.projects[index],
      project_name: input.project_name,
      user_prompt: input.user_prompt,
      brief_json: input.brief_json ?? store.projects[index].brief_json ?? {},
      content_draft: input.content_draft ?? store.projects[index].content_draft ?? null,
      model_used: input.model_used ?? store.projects[index].model_used ?? null,
      status: input.status ?? store.projects[index].status ?? 'draft',
      updated_at: timestamp,
    };

    await writeLocalStore(store);
    return store.projects[index];
  }

  const project: ProjectRecord = {
    id: randomUUID(),
    created_at: timestamp,
    updated_at: timestamp,
    project_name: input.project_name,
    user_prompt: input.user_prompt ?? null,
    brief_json: input.brief_json ?? {},
    content_draft: input.content_draft ?? null,
    model_used: input.model_used ?? null,
    status: input.status ?? 'draft',
  };

  store.projects.push(project);
  await writeLocalStore(store);
  return project;
}

export async function patchProject(id: string, updates: Partial<ProjectRecord>) {
  if (getStorageMode() === 'supabase') {
    const supabase = await createSupabaseClient();
    const payload: Database['public']['Tables']['projects']['Update'] = {
      ...(updates.id !== undefined ? { id: updates.id } : {}),
      ...(updates.created_at !== undefined ? { created_at: updates.created_at } : {}),
      ...(updates.updated_at !== undefined ? { updated_at: updates.updated_at } : {}),
      ...(updates.project_name !== undefined ? { project_name: updates.project_name } : {}),
      ...(updates.user_prompt !== undefined ? { user_prompt: updates.user_prompt } : {}),
      ...(updates.model_used !== undefined ? { model_used: updates.model_used } : {}),
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.brief_json !== undefined ? { brief_json: toJsonValue(updates.brief_json) } : {}),
      ...(updates.content_draft !== undefined ? { content_draft: toJsonValue(updates.content_draft) } : {}),
    };
    const { data, error } = await supabase
      .from('projects')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as ProjectRecord;
  }

  const store = await readLocalStore();
  const index = store.projects.findIndex((project) => project.id === id);
  if (index === -1) {
    throw new Error(`Project not found: ${id}`);
  }

  store.projects[index] = {
    ...store.projects[index],
    ...updates,
    updated_at: nowIso(),
  };
  await writeLocalStore(store);
  return store.projects[index];
}

export async function deleteProject(id: string) {
  if (getStorageMode() === 'supabase') {
    const supabase = await createSupabaseClient();
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  const store = await readLocalStore();
  store.projects = store.projects.filter((project) => project.id !== id);
  store.pipeline_results = store.pipeline_results.filter((result) => result.project_id !== id);
  store.generated_files = store.generated_files.filter((file) => file.project_id !== id);
  await writeLocalStore(store);
  const generatedProjectsDir = await getGeneratedProjectsDir();
  await fs.rm(path.join(generatedProjectsDir, id), { recursive: true, force: true });
}

export async function listPipelineResults(projectId: string): Promise<PipelineResultRecord[]> {
  if (getStorageMode() === 'supabase') {
    const supabase = await createSupabaseClient();
    const { data, error } = await supabase
      .from('pipeline_results')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as PipelineResultRecord[];
  }

  const store = await readLocalStore();
  return store.pipeline_results
    .filter((result) => result.project_id === projectId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function insertPipelineResult(record: Omit<PipelineResultRecord, 'id' | 'created_at'>) {
  if (getStorageMode() === 'supabase') {
    const supabase = await createSupabaseClient();
    const payload: Database['public']['Tables']['pipeline_results']['Insert'] = {
      ...record,
      output: toJsonValue(record.output ?? null),
    };
    const { error } = await supabase.from('pipeline_results').insert(payload);
    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  const store = await readLocalStore();
  store.pipeline_results.push({
    id: randomUUID(),
    created_at: nowIso(),
    ...record,
  });

  const projectIndex = store.projects.findIndex((project) => project.id === record.project_id);
  if (projectIndex !== -1) {
    store.projects[projectIndex].status = record.status as ProjectRecord['status'];
    store.projects[projectIndex].updated_at = nowIso();
  }

  await writeLocalStore(store);
}

export async function listGeneratedFiles(projectId: string): Promise<GeneratedFileRecord[]> {
  if (getStorageMode() === 'supabase') {
    const supabase = await createSupabaseClient();
    const { data, error } = await supabase
      .from('generated_files')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as GeneratedFileRecord[];
  }

  const store = await readLocalStore();
  return store.generated_files
    .filter((file) => file.project_id === projectId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function recordGeneratedFile(input: Omit<GeneratedFileRecord, 'id' | 'created_at' | 'version' | 'is_current'>) {
  if (getStorageMode() === 'supabase') {
    const supabase = await createSupabaseClient();
    const { data: existingFiles, error: fetchError } = await supabase
      .from('generated_files')
      .select('version')
      .eq('project_id', input.project_id)
      .eq('file_name', input.file_name)
      .order('version', { ascending: false })
      .limit(1);

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    const newVersion = existingFiles && existingFiles.length > 0
      ? ((existingFiles[0] as { version?: number }).version || 1) + 1
      : 1;

    const { error: resetError } = await supabase
      .from('generated_files')
      .update({ is_current: false })
      .eq('project_id', input.project_id)
      .eq('file_name', input.file_name);

    if (resetError) {
      throw new Error(resetError.message);
    }

    const { error } = await supabase.from('generated_files').insert({
      ...input,
      version: newVersion,
      is_current: true,
    });

    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  const store = await readLocalStore();
  const existingFiles = store.generated_files
    .filter((file) => file.project_id === input.project_id && file.file_name === input.file_name)
    .sort((a, b) => b.version - a.version);

  const newVersion = existingFiles.length > 0 ? existingFiles[0].version + 1 : 1;

  store.generated_files = store.generated_files.map((file) => {
    if (file.project_id === input.project_id && file.file_name === input.file_name) {
      return { ...file, is_current: false };
    }
    return file;
  });

  store.generated_files.push({
    id: randomUUID(),
    created_at: nowIso(),
    version: newVersion,
    is_current: true,
    ...input,
  });

  await writeLocalStore(store);
}
