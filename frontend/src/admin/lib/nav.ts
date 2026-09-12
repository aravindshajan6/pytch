/** Lets non-React modules (http interceptors, toasts) navigate via the router. */
let navigateFn: ((to: string) => void) | null = null

export function setNavigator(fn: (to: string) => void) {
  navigateFn = fn
}

export function navigateTo(to: string) {
  if (navigateFn) navigateFn(to)
  else window.location.assign(to)
}
