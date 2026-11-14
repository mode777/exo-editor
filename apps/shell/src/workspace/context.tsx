import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { WorkspacePath } from './contract'
import type { DocumentState } from './documents'
import type { PluginConfigSnapshot } from '../plugins/store'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './runtime'

const WorkspaceRuntimeContext = createContext<WorkspaceRuntime | null>(null)

export function WorkspaceRuntimeProvider({
  runtime,
  children,
}: {
  runtime: WorkspaceRuntime
  children: ReactNode
}) {
  return (
    <WorkspaceRuntimeContext.Provider value={runtime}>{children}</WorkspaceRuntimeContext.Provider>
  )
}

export function useWorkspaceRuntime(): WorkspaceRuntime {
  const runtime = useContext(WorkspaceRuntimeContext)
  if (!runtime) {
    throw new Error('useWorkspaceRuntime must be used inside WorkspaceRuntimeProvider.')
  }
  return runtime
}

export function useWorkspaceSnapshot(): WorkspaceSnapshot {
  const runtime = useWorkspaceRuntime()
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
}

export function useDocument(path: WorkspacePath | null): DocumentState | undefined {
  const runtime = useWorkspaceRuntime()
  const store = runtime.documents
  const subscribe = useCallback(
    (listener: () => void) => (path ? store.subscribe(path, listener) : () => undefined),
    [store, path],
  )
  const getSnapshot = useCallback(() => (path ? store.get(path) : undefined), [store, path])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useDirtyDocuments(): boolean {
  const runtime = useWorkspaceRuntime()
  const store = runtime.documents
  const subscribe = useCallback((listener: () => void) => store.subscribeAny(listener), [store])
  const getSnapshot = useCallback(() => store.hasDirty(), [store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function usePluginConfig(): PluginConfigSnapshot {
  const runtime = useWorkspaceRuntime()
  const store = runtime.pluginConfig
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
