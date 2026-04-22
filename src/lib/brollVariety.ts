// src/lib/brollVariety.ts
//
// Force the /api/broll endpoint to pick DIFFERENT hook templates across
// runs by varying the inputs it sees. Passing the same audience +
// controversy + empty topic yields the same ~1-2 templates every call.
// Rotating inputs breaks the homogeneity.
//
// Pure (no side effects); rng injectable for deterministic tests.

/**
 * A curated pool of real-estate + investing topics that trigger different
 * hook template families at the API level. Categorized loosely to cover
 * varied content angles: deal math, landlord ops, investor strategy,
 * tenant stories, horror/caution, contrarian takes, beginner guides, etc.
 */
export const TOPIC_POOL: string[] = [
  // deal math
  'BRRRR math that works',
  'house hacking a duplex',
  'cashflow vs appreciation tradeoff',
  'cash-on-cash returns',
  'cap rate for small multifamily',
  // landlord ops
  'tenant screening red flags',
  'turnover cost math',
  'late rent fees that work',
  'lease clauses landlords forget',
  'inspection checklist for move-in',
  // investor strategy
  'when to pull out equity',
  'refinancing a rental property',
  'finding off-market deals',
  'small market vs big city investing',
  'networking with wholesalers',
  // tenant/renter insights
  'what tenants actually want',
  'renter red flags to avoid',
  'move-out fights you can prevent',
  // horror / caution
  'the mistake that costs landlords thousands',
  'renovation surprise costs',
  'evictions done right',
  // contrarian / edgy
  'buying ugly houses on purpose',
  'why appreciation is a lie',
  'rent control workarounds',
  // beginner / educational
  'your first rental property in 30 days',
  'how to read a rent roll',
  'down payment math for beginners',
];

/**
 * Pick the next topic for a run. Prefers topics not used in the last N
 * runs (derived from recentTopics). Returns a fresh random pick if
 * everything in the pool has been used recently.
 *
 * Exported for unit testing.
 */
export function pickTopic(
  recentTopics: string[],
  rng: () => number = Math.random,
  pool: string[] = TOPIC_POOL,
): string {
  const used = new Set(recentTopics.map(t => t.toLowerCase().trim()));
  const unused = pool.filter(t => !used.has(t.toLowerCase()));
  const chooseFrom = unused.length > 0 ? unused : pool;
  const idx = Math.floor(rng() * chooseFrom.length);
  return chooseFrom[idx]!;
}

/**
 * Pick audience + controversy level for a run, rotating to create hook
 * variety. Avoids the combination most recently seen (derived from
 * recentAudience + recentControversy arrays which correspond position-
 * wise to each recent run).
 */
export function pickAudienceControversy(
  recentAudience: string[],
  recentControversy: number[],
  rng: () => number = Math.random,
): { audience: 'both' | 'landlord' | 'investor'; controversy: 1 | 2 | 3 | 4 | 5 } {
  const audienceChoices: Array<'both' | 'landlord' | 'investor'> = ['both', 'landlord', 'investor'];
  const controversyChoices: Array<1 | 2 | 3 | 4 | 5> = [2, 3, 3, 4];  // skew toward 3 with some variance

  // Avoid the most recent audience (50% of the time) to break streaks
  const lastAudience = recentAudience[0];
  let audienceOptions = audienceChoices;
  if (lastAudience && rng() < 0.5) {
    audienceOptions = audienceChoices.filter(a => a !== lastAudience);
    if (audienceOptions.length === 0) audienceOptions = audienceChoices;
  }
  const audience = audienceOptions[Math.floor(rng() * audienceOptions.length)]!;

  // Similar nudge for controversy: avoid exactly the last value half the time
  const lastC = recentControversy[0];
  let controversyOptions = controversyChoices;
  if (typeof lastC === 'number' && rng() < 0.5) {
    controversyOptions = controversyChoices.filter(c => c !== lastC);
    if (controversyOptions.length === 0) controversyOptions = controversyChoices;
  }
  const controversy = controversyOptions[Math.floor(rng() * controversyOptions.length)]!;

  return { audience, controversy };
}
