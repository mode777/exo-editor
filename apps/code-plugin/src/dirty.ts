/** A save clears dirty only when no model change happened after the request. */
export function shouldClearDirty(
  savedGeneration: number | null,
  currentGeneration: number,
): boolean {
  return savedGeneration !== null && savedGeneration === currentGeneration
}
