/**
 * Front-desk alert chime — two soft notes synthesised with Web Audio (no asset to load). Browsers only allow
 * sound after the user has interacted with the page, so the context is unlocked on the first tap/click.
 * The mute preference is per device.
 */
const PREF = 'pytch-partner-chime'
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx ??= new Ctor()
  return ctx
}

if (typeof window !== 'undefined') {
  const unlock = () => void audio()?.resume()
  window.addEventListener('pointerdown', unlock, { once: true, capture: true })
  window.addEventListener('keydown', unlock, { once: true, capture: true })
}

export function chimeEnabled(): boolean {
  try {
    return localStorage.getItem(PREF) !== 'off'
  } catch {
    return true
  }
}

export function setChimeEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? 'on' : 'off')
  } catch {
    /* private mode: stays on for this visit */
  }
}

/** `up` = new booking (rising), `down` = released (falling). Silent if muted or audio is still locked. */
export function playChime(kind: 'up' | 'down' = 'up') {
  if (!chimeEnabled()) return
  const ac = audio()
  if (!ac || ac.state !== 'running') return
  const notes = kind === 'up' ? [660, 990] : [880, 587]
  const t0 = ac.currentTime
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const start = t0 + i * 0.16
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32)
    osc.connect(gain).connect(ac.destination)
    osc.start(start)
    osc.stop(start + 0.34)
  })
}
