import { Compass } from 'lucide-react'
import { LinkButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/States'

export default function PartnerNotFound() {
  return (
    <EmptyState
      className="mt-10"
      icon={<Compass className="mx-auto h-10 w-10 text-muted" />}
      title="This page doesn’t exist"
      description="It may have moved, or you may not have access with your current role."
      action={<LinkButton to="/partner">Back to dashboard</LinkButton>}
    />
  )
}
