import type { HtmlTagDescriptor, Plugin } from 'vite'

// The ratified policy for the deployed shell. GitHub Pages cannot set response
// headers, so this is embedded in the document instead. Deliberately no
// `default-src` and no `style-src`: the workbench kit positions sashes and
// panels with inline style attributes, and the spec fixes the directive set.
export const CSP_DIRECTIVES =
  "frame-src https: http://localhost:*; connect-src 'self' https: http://localhost:*; script-src 'self'"

export const CSP_META_TAG: HtmlTagDescriptor = {
  tag: 'meta',
  attrs: {
    'http-equiv': 'Content-Security-Policy',
    content: CSP_DIRECTIVES,
  },
  injectTo: 'head-prepend',
}

export function exoCspPlugin(): Plugin {
  return {
    name: 'exo-csp-meta',
    // Build only: the Vite dev server's HMR preamble is an inline script and
    // the dev server is not the deployed artifact.
    apply: 'build',
    transformIndexHtml(): HtmlTagDescriptor[] {
      return [CSP_META_TAG]
    },
  }
}
