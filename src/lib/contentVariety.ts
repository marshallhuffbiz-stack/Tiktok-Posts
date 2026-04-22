// src/lib/contentVariety.ts
//
// Pure helpers that inject variety into AI-generated caption + hashtag sets.
// The /api/broll endpoint tends to return the same 6 hashtags every call
// and the same 3-4 caption opening patterns. Across many posts that looks
// automated even when every video is different. These helpers add
// randomization so no two posts look templated.

/** Niche-specific hashtag pool. Curated to be real-estate / investing
 *  focused without being over-used (skipping #fyp intentionally — it's
 *  algorithmically deprioritized for small accounts). */
export const HASHTAG_POOL: string[] = [
  '#realestate',
  '#realestateinvesting',
  '#realestatetips',
  '#rentalproperty',
  '#landlord',
  '#landlordlife',
  '#landlordtips',
  '#propertymanagement',
  '#tenantscreening',
  '#cashflow',
  '#passiveincome',
  '#investing',
  '#BRRRR',
  '#househacking',
  '#smallmultifamily',
  '#duplex',
  '#fixandflip',
  '#rentalinvesting',
  '#propertyinvestor',
  '#wealthbuilding',
  '#financialfreedom',
  '#sidehustle',
  '#moneytok',
  '#firsthome',
  '#cashoutrefi',
  '#dealanalysis',
  '#buyandhold',
  '#reitips',
];

/**
 * Merge API-returned hashtags with the pool, producing a diversified set.
 *
 * Strategy: keep the API's first `keepApi` tags (they're topic-specific),
 * then fill to `targetCount` with random picks from the pool that aren't
 * already in the merged set. Also removes any of the always-present
 * tags we want to drop (e.g., over-used #fyp).
 *
 * Exported for unit testing. Pass a deterministic rng in tests.
 */
export function diversifyHashtags(
  apiTags: string[],
  rng: () => number = Math.random,
  opts: { keepApi?: number; targetCount?: number; drop?: string[] } = {},
): string[] {
  const keepApi = opts.keepApi ?? 3;
  const targetCount = opts.targetCount ?? 5;
  const drop = new Set((opts.drop ?? ['#fyp', '#foryou', '#foryoupage', '#viral']).map(s => s.toLowerCase()));

  const normalize = (t: string): string => {
    const s = (t.startsWith('#') ? t : `#${t}`).trim();
    return s;
  };
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const raw of apiTags) {
    if (kept.length >= keepApi) break;
    const norm = normalize(raw);
    if (drop.has(norm.toLowerCase())) continue;
    if (seen.has(norm.toLowerCase())) continue;
    seen.add(norm.toLowerCase());
    kept.push(norm);
  }

  // Fill from the pool
  const poolShuffled = [...HASHTAG_POOL].sort(() => rng() - 0.5);
  for (const tag of poolShuffled) {
    if (kept.length >= targetCount) break;
    if (drop.has(tag.toLowerCase())) continue;
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    kept.push(tag);
  }

  return kept;
}

/**
 * Rewrite the caption body to reduce template-pattern signals.
 *
 * - If it starts with one of the AI's repeating openers ("Most people only see...",
 *   "Most people stop at...", "The part people miss..."), occasionally replace
 *   that with a more varied rephrasing.
 * - Occasionally add a tiny lowercase flourish at the start (mimicking mobile
 *   casual typing).
 *
 * Keep the hashtags separate — this only touches the body text.
 */
const OPENER_REWRITES: Array<{ pattern: RegExp; alts: string[] }> = [
  {
    pattern: /^Most people only see /i,
    alts: ['Everyone fixates on ', 'The number people watch is ', "Folks don't look past "],
  },
  {
    pattern: /^Most people stop at /i,
    alts: ['Deal math dies at ', 'The buyer crowd only counts ', "Here's where most stop — "],
  },
  {
    pattern: /^The part people miss /i,
    alts: ['What gets skipped ', 'The math that flips the deal ', 'The quiet win '],
  },
  {
    pattern: /^Most people hear /i,
    alts: ['People hear ', 'Everyone assumes ', 'The default read on '],
  },
  {
    pattern: /^Most people call /i,
    alts: ['Folks call ', "They'll label ", 'The easy read on '],
  },
  {
    pattern: /^Most people see /i,
    alts: ['Everyone sees ', 'The first glance is ', 'People read '],
  },
];

export function rewriteCaptionOpener(body: string, rng: () => number = Math.random): string {
  // 60% chance of rewriting any match, so we still sometimes keep the AI text
  if (rng() > 0.6) return body;
  for (const { pattern, alts } of OPENER_REWRITES) {
    if (pattern.test(body)) {
      const alt = alts[Math.floor(rng() * alts.length)]!;
      return body.replace(pattern, alt);
    }
  }
  return body;
}
