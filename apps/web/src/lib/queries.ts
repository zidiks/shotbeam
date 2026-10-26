import type {
  Analysis,
  Asset,
  AssetRole,
  Composition,
  CompositionOp,
  Format,
  Job,
  Project,
  PublicSettings,
  Reference,
  Source,
  Voice,
} from '@shotbeam/core'
import { query } from '@shotbeam/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from './api'

/*
 * Data from the engine. Query keys start with the entity name the engine announces over SSE
 * (lib/events.ts), so a change made anywhere (Claude over MCP, a job) refreshes what shows it.
 */

export const keys = {
  projects: ['project'] as const,
  sources: (projectId?: string) => ['source', projectId] as const,
  assets: (params: Record<string, unknown>) => ['asset', 'list', params] as const,
  asset: (id: string) => ['asset', id] as const,
  references: (projectId?: string) => ['reference', projectId] as const,
  reference: (id: string) => ['reference', 'one', id] as const,
  formats: (projectId?: string) => ['format', projectId] as const,
  format: (id: string) => ['format', 'one', id] as const,
  voices: ['voice'] as const,
  providers: ['voice', 'providers'] as const,
  compositions: (projectId?: string) => ['composition', projectId] as const,
  composition: (id: string) => ['composition', 'one', id] as const,
  settings: ['settings'] as const,
  setup: ['settings', 'setup'] as const,
  jobs: ['job'] as const,
  motion: ['motion'] as const,
  fonts: ['fonts'] as const,
}

export function errorToast(err: unknown) {
  toast.error(err instanceof Error ? err.message : String(err))
}

export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: () => api.get<Project[]>('/api/projects') })

export const useSources = (projectId?: string) =>
  useQuery({
    queryKey: keys.sources(projectId),
    queryFn: () => api.get<Source[]>(`/api/sources${query({ projectId })}`),
    enabled: !!projectId,
  })

export interface AssetFilter {
  projectId?: string
  role?: AssetRole
  q?: string
  kind?: string
  limit?: number
}

export const useAssets = (f: AssetFilter) =>
  useQuery({
    queryKey: keys.assets(f as Record<string, unknown>),
    queryFn: () =>
      api.get<{ items: Asset[]; total: number }>(
        `/api/assets${query({ ...f, limit: f.limit ?? 200 })}`,
      ),
    enabled: !!f.projectId,
    placeholderData: (prev) => prev,
  })

export const useAsset = (id: string | null) =>
  useQuery({
    queryKey: keys.asset(id ?? ''),
    queryFn: () => api.get<{ asset: Asset; analysis: Analysis; jobs: Job[] }>(`/api/assets/${id}`),
    enabled: !!id,
  })

export const useReferences = (projectId?: string) =>
  useQuery({
    queryKey: keys.references(projectId),
    queryFn: () => api.get<Reference[]>(`/api/references${query({ projectId })}`),
  })

export const useReference = (id: string | null) =>
  useQuery({
    queryKey: keys.reference(id ?? ''),
    queryFn: () => api.get<{ reference: Reference; asset: Asset | null }>(`/api/references/${id}`),
    enabled: !!id,
  })

export const useFormats = (projectId?: string) =>
  useQuery({
    queryKey: keys.formats(projectId),
    queryFn: () => api.get<Format[]>(`/api/formats${query({ projectId })}`),
  })

export const useFormat = (id: string | null) =>
  useQuery({
    queryKey: keys.format(id ?? ''),
    queryFn: () => api.get<Format>(`/api/formats/${id}`),
    enabled: !!id,
  })

export const useVoices = () =>
  useQuery({ queryKey: keys.voices, queryFn: () => api.get<Voice[]>('/api/voices') })

export interface ProviderStatus {
  id: Voice['provider']
  label: string
  available: boolean
  detail: string
  clones: boolean
  local: boolean
  languages: string
}

export const useProviders = () =>
  useQuery({
    queryKey: keys.providers,
    queryFn: () => api.get<ProviderStatus[]>('/api/voice-providers'),
  })

export const useCompositions = (projectId?: string) =>
  useQuery({
    queryKey: keys.compositions(projectId),
    queryFn: () => api.get<Composition[]>(`/api/compositions${query({ projectId })}`),
    enabled: !!projectId,
  })

export const useComposition = (id: string | null) =>
  useQuery({
    queryKey: keys.composition(id ?? ''),
    queryFn: () => api.get<Composition>(`/api/compositions/${id}`),
    enabled: !!id,
  })

export const useSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: () => api.get<PublicSettings>('/api/settings') })

export interface SetupStatus {
  library: string
  mcpEntry: string
  python: { ready: boolean; features: Record<string, boolean> | null }
  voices: ProviderStatus[]
  motion: Record<'hyperframes' | 'remotion', { ready: boolean; detail: string }>
}

export const useSetup = () =>
  useQuery({ queryKey: keys.setup, queryFn: () => api.get<SetupStatus>('/api/setup') })

export const useJobs = () =>
  useQuery({
    queryKey: keys.jobs,
    queryFn: () => api.get<Job[]>('/api/jobs?limit=30'),
    refetchInterval: 15_000,
  })

export interface MotionTemplate {
  engine: 'hyperframes' | 'remotion'
  name: string
  description: string
  duration: number
  overlay: boolean
  variables: { name: string; type: string; default: unknown; description: string }[]
}

export const useMotionTemplates = () =>
  useQuery({
    queryKey: keys.motion,
    queryFn: () => api.get<MotionTemplate[]>('/api/motion/templates'),
  })

export const useFonts = () =>
  useQuery({
    queryKey: keys.fonts,
    queryFn: () => api.get<{ file: string; family: string }[]>('/api/fonts'),
  })

/** How many edits can be undone / redone (kept by the engine, Claude's edits included). */
export const useCompositionHistory = (id: string) =>
  useQuery({
    queryKey: ['composition', 'history', id],
    queryFn: () => api.get<{ undo: number; redo: number }>(`/api/compositions/${id}/history`),
  })

export function useUndoRedo(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (direction: 'undo' | 'redo') =>
      api.post<Composition>(`/api/compositions/${id}/${direction}`),
    onSuccess: (c) => {
      qc.setQueryData(keys.composition(id), c)
      qc.invalidateQueries({ queryKey: ['composition', 'history', id] })
    },
    onError: (err) => {
      // An empty history is not an error worth a toast.
      if (!/Nothing to (undo|redo)/.test(String((err as Error).message))) errorToast(err)
    },
  })
}

/** Edits of a composition: applied on the engine (validated there), the result replaces the cache. */
export function useCompositionOps(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ops: CompositionOp[]) =>
      api.post<{ composition: Composition; created: string[] }>(`/api/compositions/${id}/ops`, {
        ops,
      }),
    onSuccess: (r) => qc.setQueryData(keys.composition(id), r.composition),
    onError: errorToast,
  })
}
