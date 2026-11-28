/** The model is dirty only while its text differs from the last saved text. */
export function isDirty(savedText: string, currentText: string): boolean {
  return currentText !== savedText
}
