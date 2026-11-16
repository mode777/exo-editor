/** Append a visible marker so a save round-trip is observable in the file. */
export function withSaveMarker(text: string, saveNumber: number): string {
  return `${text}\n[template save ${saveNumber}]`
}
