import axe, { type AxeResults } from 'axe-core'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/**
 * Runs the WCAG rules against one Exo-owned surface. jsdom has no layout, so
 * `color-contrast` is not part of the result; theme contrast is covered by
 * `accessibility-contrast.test.ts` and the deployed manual script.
 */
export async function runAxe(container: Element): Promise<AxeResults> {
  return axe.run(container, {
    runOnly: { type: 'tag', values: WCAG_TAGS },
    // jsdom has no layout or canvas; theme contrast is a token test instead.
    rules: { 'color-contrast': { enabled: false } },
  })
}

/** One line per violation, stable enough for a test assertion message. */
export function describeAxeViolations(results: AxeResults): string[] {
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.nodes
        .map((node) => node.target.join(' '))
        .join(', ')}`,
  )
}
