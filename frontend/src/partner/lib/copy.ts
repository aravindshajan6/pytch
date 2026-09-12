import { toast } from 'sonner'

export async function copyText(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(what)
  } catch {
    toast.error('Copy failed — select the text and copy it manually')
  }
}
