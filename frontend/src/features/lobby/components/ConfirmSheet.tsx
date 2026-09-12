import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'

export interface ConfirmConfig {
  title: string
  body: React.ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  onConfirm: () => Promise<unknown> | void
}

/** Small confirm dialog used for leave / cancel / kick. */
export function ConfirmSheet({
  config,
  onClose,
  busy,
}: {
  config: ConfirmConfig | null
  onClose: () => void
  busy?: boolean
}) {
  return (
    <Sheet open={!!config} onClose={onClose} size="sm" title={config?.title}>
      {config && (
        <div>
          <div className="text-sm leading-relaxed text-muted">{config.body}</div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Never mind
            </Button>
            <Button variant={config.tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={() => config.onConfirm()}>
              {config.confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
