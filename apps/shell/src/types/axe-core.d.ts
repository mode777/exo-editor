declare module 'axe-core' {
  export interface AxeNodeResult {
    target: string[]
    html: string
    failureSummary?: string
  }

  export interface AxeRuleResult {
    id: string
    impact?: string | null
    help: string
    nodes: AxeNodeResult[]
  }

  export interface AxeResults {
    violations: AxeRuleResult[]
    incomplete: AxeRuleResult[]
    passes: AxeRuleResult[]
    inapplicable: AxeRuleResult[]
  }

  export interface AxeRunOptions {
    runOnly?: { type: 'tag'; values: string[] }
    rules?: Record<string, { enabled: boolean }>
    resultTypes?: Array<'violations' | 'incomplete' | 'passes' | 'inapplicable'>
  }

  const axe: {
    run(context?: Element | Document | string, options?: AxeRunOptions): Promise<AxeResults>
  }

  export default axe
}
