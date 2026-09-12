import type { RatingInput } from '@/types/api'

export interface RatingDraft {
  skill: number
  fair_play: number
  reliability: number
  showed_up: boolean
  tags: string[]
}

export const emptyDraft = (): RatingDraft => ({ skill: 0, fair_play: 0, reliability: 0, showed_up: true, tags: [] })

export const isComplete = (d: RatingDraft) => !d.showed_up || (d.skill > 0 && d.fair_play > 0 && d.reliability > 0)

/** No-shows can't be judged on the ball: neutral skill/fair play, 1★ reliability. */
export const toInput = (rateeId: string, d: RatingDraft): RatingInput =>
  d.showed_up
    ? { ratee_id: rateeId, skill: d.skill, fair_play: d.fair_play, reliability: d.reliability, showed_up: true, tags: d.tags }
    : { ratee_id: rateeId, skill: 3, fair_play: 3, reliability: 1, showed_up: false, tags: [] }
