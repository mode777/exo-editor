// jsdom does not implement the form-associated custom element internals that
// vscode-elements' textfield uses. Stub the two methods it calls so the preset's
// quick-open dialog can mount in unit tests.
const internalsPrototype = window.ElementInternals?.prototype as
  (ElementInternals & { setFormValue?: () => void; setValidity?: () => void }) | undefined

if (internalsPrototype) {
  internalsPrototype.setFormValue ??= () => undefined
  internalsPrototype.setValidity ??= () => undefined
}

// jsdom does not implement scrollIntoView; the preset's quick open calls it.
Element.prototype.scrollIntoView ??= () => undefined
