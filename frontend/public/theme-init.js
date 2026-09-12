// Apply the saved theme before first paint (no flash). Mirrors src/stores/theme.ts.
// External file (not inline) so the Content-Security-Policy can forbid inline scripts.
;(function () {
  try {
    var mode = (JSON.parse(localStorage.getItem('pytch-theme') || '{}').state || {}).mode || 'dark'
    var t = mode === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode
    var r = document.documentElement
    r.dataset.theme = t
    r.classList.toggle('dark', t === 'dark')
    var m = document.querySelector('meta[name="theme-color"]')
    if (m) m.setAttribute('content', t === 'light' ? '#f2f5ef' : '#05080a')
  } catch (e) {}
})()
