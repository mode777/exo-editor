import { describe, expect, it } from 'vitest'
import type { HtmlTagDescriptor } from 'vite'
import { CSP_DIRECTIVES, exoCspPlugin } from './csp'

describe('content security policy injection', () => {
  it('is applied at build time only', () => {
    const plugin = exoCspPlugin()

    expect(plugin.apply).toBe('build')
  })

  it('emits exactly the ratified directives', () => {
    const plugin = exoCspPlugin()
    const transform = plugin.transformIndexHtml as () => HtmlTagDescriptor[]
    const tags = transform()

    expect(tags).toHaveLength(1)
    const [tag] = tags
    expect(tag.tag).toBe('meta')
    expect(tag.attrs?.['http-equiv']).toBe('Content-Security-Policy')
    expect(tag.attrs?.content).toBe(CSP_DIRECTIVES)
    expect(tag.injectTo).toBe('head-prepend')

    expect(CSP_DIRECTIVES).toContain('frame-src https: http://localhost:*')
    expect(CSP_DIRECTIVES).toContain("connect-src 'self' https: http://localhost:*")
    expect(CSP_DIRECTIVES).toContain("script-src 'self'")
  })

  it('allows only localhost as a plain-HTTP source', () => {
    const tokens = CSP_DIRECTIVES.split(/[\s;]+/).filter(Boolean)
    expect(tokens).not.toContain('http:')
    expect(tokens.filter((token) => token.startsWith('http:'))).toEqual([
      'http://localhost:*',
      'http://localhost:*',
    ])
    expect(CSP_DIRECTIVES).toContain('frame-src https: http://localhost:*')
    expect(CSP_DIRECTIVES).toContain("connect-src 'self' https: http://localhost:*")
  })

  it('never allows dynamic evaluation or inline scripts', () => {
    expect(CSP_DIRECTIVES).not.toContain('unsafe-eval')
    expect(CSP_DIRECTIVES).not.toContain('unsafe-inline')
  })

  it('adds no default-src or style-src directive', () => {
    expect(CSP_DIRECTIVES).not.toContain('default-src')
    expect(CSP_DIRECTIVES).not.toContain('style-src')
  })
})
