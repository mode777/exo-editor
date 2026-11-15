const bus = new EventTarget()

/** Asks the shell to open the remote-connect dialog from anywhere in the UI. */
export function requestRemoteConnect(): void {
  bus.dispatchEvent(new CustomEvent('connect'))
}

export function onRemoteConnect(listener: () => void): () => void {
  bus.addEventListener('connect', listener)
  return () => bus.removeEventListener('connect', listener)
}
