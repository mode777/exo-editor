export interface Greeting {
  name: string
  excited: boolean
}

export function greet({ name, excited }: Greeting): string {
  return `Hello, ${name}${excited ? '!' : '.'}`
}

export const greeting = greet({ name: 'Exo', excited: true })
