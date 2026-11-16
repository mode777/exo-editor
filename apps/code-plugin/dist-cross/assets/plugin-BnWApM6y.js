import { t as e } from './browser-CHUdV5dg.js'
var t = [
  { glob: `**/*.{ts,tsx}`, entry: `editor.html`, label: `TypeScript` },
  { glob: `**/*.{js,jsx}`, entry: `editor.html`, label: `JavaScript` },
  { glob: `**/*.json`, entry: `editor.html`, label: `JSON` },
  { glob: `**/*.md`, entry: `editor.html`, label: `Markdown` },
]
async function n() {
  try {
    let n = await e()
    if (n.mode !== `register`) throw Error(`The controller entry must be mounted in register mode.`)
    for (let e of t) n.registration.register(e)
    let r = await n.registration.complete()
    console.log(`EXO_CODE_REGISTER`, r.accepted, r.rejected)
  } catch (e) {
    console.error(`EXO_CODE_REGISTER_ERROR`, e)
  }
}
n()
