import type { Tier, UserPublic } from '@/types/api'

/** Illustrative players for the marketing demos (not real accounts). */
export type DemoPlayer = Pick<UserPublic, 'id' | 'name' | 'avatar_url'> & { tier?: Tier; is_verified_playmaker?: boolean }

const p = (id: string, name: string, tier: Tier = 'regular', verified = false): DemoPlayer => ({
  id: `demo-${id}`,
  name,
  avatar_url: null,
  tier,
  is_verified_playmaker: verified,
})

export const DEMO_PLAYERS: DemoPlayer[] = [
  p('arjun', 'Arjun Menon', 'skilled', true),
  p('aisha', 'Aisha Kareem', 'elite', true),
  p('rahul', 'Rahul Nair'),
  p('fathima', 'Fathima Riyas', 'skilled'),
  p('joel', 'Joel Thomas'),
  p('sree', 'Sreehari P', 'skilled'),
  p('meera', 'Meera Das'),
  p('vishnu', 'Vishnu Raj', 'elite'),
  p('nadia', 'Nadia Ali'),
  p('ashwin', 'Ashwin K', 'rookie'),
  p('anand', 'Anand George'),
  p('liya', 'Liya Joseph', 'skilled'),
]

export const STATS_ROW_A = [
  '142 turfs across Kochi',
  '18,400+ players',
  '3,120 matches this month',
  '94% of splits fill in 30 min',
  '₹0 chased on WhatsApp',
  '212 subs off the bench this week',
]

export const STATS_ROW_B = [
  '⚽ Kaloor',
  '🏏 Edappally',
  '🏸 Kakkanad',
  '⚽ Fort Kochi',
  '🥒 Panampilly Nagar',
  '🏀 Vyttila',
  '⚽ Palarivattom',
  '🏏 Aluva',
  '🏸 Kadavanthra',
  '⚽ Marine Drive',
]

export const TESTIMONIALS = [
  {
    player: DEMO_PLAYERS[0]!,
    area: 'Kaloor',
    ts: 74,
    quote: 'I used to front ₹1,800 every Thursday and spend the weekend chasing UPI. Now the link goes out, the timer runs, and the game locks itself.',
  },
  {
    player: DEMO_PLAYERS[1]!,
    area: 'Kakkanad',
    ts: 81,
    quote: 'Two lads dropped 40 minutes before kick-off. SOS went out, a sub from the bench paid in six minutes. We didn’t even have to text anyone.',
  },
  {
    player: DEMO_PLAYERS[7]!,
    area: 'Edappally',
    ts: 77,
    quote: 'Rain alert at 5, moved indoors by 5:02 for zero extra. My squad thinks I planned it. I just tapped a button.',
  },
]
