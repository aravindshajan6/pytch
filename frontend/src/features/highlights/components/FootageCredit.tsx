import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/cn'

interface FootageEntry {
  file: string
  source: string
  license: string
  attribution: string
}

/** Demo footage is CC BY-SA (see backend/media/README.md) — credit it wherever it plays. */
function useFootageManifest() {
  return useQuery({
    queryKey: ['media', 'footage-manifest'],
    queryFn: async (): Promise<FootageEntry[]> => {
      const res = await fetch('/media/footage/manifest.json')
      return res.ok ? res.json() : []
    },
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

export function FootageCredit({ videoUrl, className, compact }: { videoUrl: string | null | undefined; className?: string; compact?: boolean }) {
  const { data } = useFootageManifest()
  const file = videoUrl?.split('#')[0]?.split('/').pop()
  const entry = data?.find((e) => e.file === file)
  if (!entry) return null
  const license = entry.license.split(' (')[0]
  return (
    <a
      href={entry.source}
      target="_blank"
      rel="noreferrer"
      title={entry.attribution}
      onClick={(e) => e.stopPropagation()}
      className={cn('text-[10px] text-subtle transition hover:text-fg', compact ? 'rounded-full bg-ink-950/60 px-2 py-0.5 backdrop-blur' : 'block', className)}
    >
      {compact ? `CC ${license.replace('CC ', '')}` : `Demo footage: ${entry.attribution}`}
    </a>
  )
}
