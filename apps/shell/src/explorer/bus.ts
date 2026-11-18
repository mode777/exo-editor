export type ExplorerCommand = 'new-file' | 'new-folder' | 'rename' | 'delete' | 'collapse-all'

const bus = new EventTarget()

export function requestExplorerCommand(command: ExplorerCommand): void {
  bus.dispatchEvent(new CustomEvent('command', { detail: command }))
}

export function onExplorerCommand(listener: (command: ExplorerCommand) => void): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<ExplorerCommand>).detail)
  }
  bus.addEventListener('command', handler)
  return () => bus.removeEventListener('command', handler)
}
