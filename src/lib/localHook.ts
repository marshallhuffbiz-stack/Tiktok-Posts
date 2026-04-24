// src/lib/localHook.ts
//
// Local fallback for hook generation when /api/broll returns hook:null
// (its OpenAI/Anthropic call fails silently). We pick from a curated
// library of templates with variable-substituted numbers/locations to
// generate overlay_lines + closer + caption + hashtags entirely client-
// side. No external dependency, no AI cost, deterministic when seeded.
//
// Each template family produces a structurally distinct hook shape so
// post-to-post variety is preserved even without the AI.

import type { BRollSettings } from './types.js';

export interface LocalHook {
  overlay_lines: string[];
  closer_line: string;
  caption: string;
  hashtags: string[];
  template_id: string;
  controversy_level: number;
  audience: string;
  rationale: string | null;
}

// ---------- variable pools (numbers, places, etc.) ----------

const CITIES_SMALL = ['Akron', 'Toledo', 'Erie', 'Davenport', 'Macon', 'Shreveport', 'Topeka', 'Springfield', 'Lansing'];
const CITIES_BIG = ['Austin', 'Phoenix', 'Charlotte', 'Nashville', 'Tampa', 'Raleigh', 'Atlanta', 'Denver'];

function rand<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function fmt(n: number): string {
  // Render numbers with thousands separator (118000 → 118,000)
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US');
  return String(n);
}

function dollars(n: number): string {
  return `$${fmt(n)}`;
}

function range(rng: () => number, min: number, max: number, step = 1): number {
  const span = Math.floor((max - min) / step) + 1;
  return min + Math.floor(rng() * span) * step;
}

// ---------- template families ----------

interface TemplateContext {
  topic: string;
  audience: string;
  controversy: number;
  rng: () => number;
}

interface Template {
  id: string;
  generate(ctx: TemplateContext): LocalHook;
}

const TEMPLATES: Template[] = [
  // ---------- BRRRR / equity-pull math ----------
  {
    id: 'LOCAL-BRRRR-001',
    generate: ({ rng, audience, controversy }) => {
      const buy = range(rng, 90, 165, 5) * 1000;
      const rehab = range(rng, 18, 38) * 1000;
      const arv = Math.round((buy + rehab) * (1.30 + rng() * 0.25));
      const refi = Math.round(arv * 0.75);
      const left = Math.max(0, buy + rehab - refi);
      return {
        overlay_lines: [
          `Buy at ${dollars(buy)} all in`,
          `Rehab eats ${dollars(rehab)}`,
          `Appraisal lands at ${dollars(arv)}`,
          `Refi at 75% pulls ${dollars(refi)}`,
          left === 0
            ? 'You leave 0 in the deal'
            : `You leave only ${dollars(left)} in`,
        ],
        closer_line: 'I run this in Rent Roll before I bid.',
        caption: `Most folks freeze at the rehab number. The refi is where the cash math actually works. If the appraisal hits, you keep the door for almost nothing down. Run the numbers before you pass.`,
        hashtags: ['#realestate', '#BRRRR', '#rentalproperty', '#realestatetips', '#cashflow'],
        template_id: 'LOCAL-BRRRR-001',
        controversy_level: controversy,
        audience,
        rationale: null,
      };
    },
  },

  // ---------- House-hacking math ----------
  {
    id: 'LOCAL-HH-001',
    generate: ({ rng, audience, controversy }) => {
      const buy = range(rng, 250, 480, 10) * 1000;
      const down = Math.round(buy * 0.05);
      const rentEach = range(rng, 1100, 1850, 50);
      const piti = Math.round(buy * 0.0067);  // rough monthly all-in estimate
      const cover = rentEach - piti / 2;
      return {
        overlay_lines: [
          `Buy a duplex at ${dollars(buy)}`,
          `${dollars(down)} down with FHA`,
          `Each side rents for ${dollars(rentEach)}`,
          `Your half of PITI: ${dollars(Math.round(piti/2))}`,
          cover > 0
            ? `Tenant pays you ${dollars(cover)} a month`
            : `Your housing bill drops to ${dollars(Math.abs(cover))}`,
        ],
        closer_line: 'House hacking. The math fits in Rent Roll.',
        caption: `One down payment turns one roof into two rent checks. The cleanest path I know to first-time investing. Save this before you keep paying full rent for a place you do not own.`,
        hashtags: ['#househacking', '#firsthome', '#realestate', '#realestateinvesting', '#duplex'],
        template_id: 'LOCAL-HH-001',
        controversy_level: controversy,
        audience,
        rationale: null,
      };
    },
  },

  // ---------- Tenant screening checklist ----------
  {
    id: 'LOCAL-SCREEN-001',
    generate: ({ rng, audience, controversy }) => {
      const monthsPay = range(rng, 2, 4);
      const ratio = range(rng, 28, 35);
      const minScore = range(rng, 600, 680, 10);
      const evictionWindow = range(rng, 5, 10);
      return {
        overlay_lines: [
          `Ask for ${monthsPay} months of pay stubs`,
          `Income must be ${ratio}% rent or less`,
          `Credit score floor: ${minScore}`,
          `No evictions in last ${evictionWindow} years`,
          `Verify employer with a phone call`,
        ],
        closer_line: 'I score every applicant in Rent Roll.',
        caption: `Bad screening is what turns a good cash flow into a 6-month nightmare. These five filters catch most of it. Save this checklist for your next application.`,
        hashtags: ['#tenantscreening', '#landlord', '#landlordtips', '#rentalproperty', '#propertymanagement'],
        template_id: 'LOCAL-SCREEN-001',
        controversy_level: controversy,
        audience,
        rationale: null,
      };
    },
  },

  // ---------- Cap rate math ----------
  {
    id: 'LOCAL-CAPRATE-001',
    generate: ({ rng, audience, controversy }) => {
      const buy = range(rng, 280, 520, 10) * 1000;
      const units = rand([3, 4, 5, 6, 8], rng);
      const rentPerUnit = range(rng, 950, 1450, 50);
      const monthlyRent = units * rentPerUnit;
      const annualRent = monthlyRent * 12;
      const expenses = Math.round(annualRent * 0.45);
      const noi = annualRent - expenses;
      const capRate = (noi / buy * 100).toFixed(1);
      return {
        overlay_lines: [
          `Buy a ${units}-unit at ${dollars(buy)}`,
          `Collect ${dollars(monthlyRent)} a month`,
          `Subtract ${dollars(expenses)} a year`,
          `Net Operating Income: ${dollars(noi)}`,
          `Cap rate: ${capRate}%`,
        ],
        closer_line: `That number is what banks lend on. I track it in Rent Roll.`,
        caption: `Cap rate sounds fancy but it is just the deal's true yield. Anything above 8% in a stable market is worth a second look. Most listings overstate it. Run your own.`,
        hashtags: ['#realestateinvesting', '#smallmultifamily', '#caprate', '#rentalproperty', '#dealanalysis'],
        template_id: 'LOCAL-CAPRATE-001',
        controversy_level: controversy,
        audience,
        rationale: null,
      };
    },
  },

  // ---------- Small-market vs big-market contrast ----------
  {
    id: 'LOCAL-MARKETS-001',
    generate: ({ rng, audience, controversy }) => {
      const small = rand(CITIES_SMALL, rng);
      const big = rand(CITIES_BIG, rng);
      const smallBuy = range(rng, 95, 145, 5) * 1000;
      const smallRent = range(rng, 1250, 1650, 50);
      const bigBuy = range(rng, 380, 580, 10) * 1000;
      const bigRent = range(rng, 1900, 2400, 50);
      return {
        overlay_lines: [
          `Same niche, two markets`,
          `${small} buy: ${dollars(smallBuy)}`,
          `${small} rent: ${dollars(smallRent)}/mo`,
          `${big} buy: ${dollars(bigBuy)}`,
          `${big} rent: ${dollars(bigRent)}/mo`,
        ],
        closer_line: `Cashflow per dollar wins. I compare in Rent Roll.`,
        caption: `Big-city numbers look impressive until you do the math per dollar invested. ${small} buys 4x the door for the same capital. Pick the market your spreadsheet picks, not the one your ego picks.`,
        hashtags: ['#realestateinvesting', '#cashflow', '#smallmultifamily', '#investing', '#wealthbuilding'],
        template_id: 'LOCAL-MARKETS-001',
        controversy_level: controversy,
        audience,
        rationale: null,
      };
    },
  },

  // ---------- Mistake / horror story ----------
  {
    id: 'LOCAL-MISTAKE-001',
    generate: ({ rng, audience, controversy }) => {
      const lostAmount = range(rng, 1800, 7200, 100);
      const days = range(rng, 28, 75, 1);
      return {
        overlay_lines: [
          `One bad application ate ${dollars(lostAmount)}`,
          `Tenant moved in on a Friday`,
          `Stopped paying by month two`,
          `Took ${days} days to evict`,
          `Five filters would have caught it`,
        ],
        closer_line: `Save this filter list in Rent Roll.`,
        caption: `Cheap screening is the most expensive line item in this business. Tighten the front door and the back door takes care of itself. The whole loss was preventable.`,
        hashtags: ['#landlord', '#landlordtips', '#tenantscreening', '#rentalproperty', '#landlordlife'],
        template_id: 'LOCAL-MISTAKE-001',
        controversy_level: controversy,
        audience,
        rationale: null,
      };
    },
  },

  // ---------- Cashflow vs appreciation ----------
  {
    id: 'LOCAL-CFAPPR-001',
    generate: ({ rng, audience, controversy }) => {
      const buy = range(rng, 200, 380, 10) * 1000;
      const cashflow = range(rng, 180, 420, 10);
      const appPct = range(rng, 3, 6);
      const appAmount = Math.round(buy * appPct / 100);
      return {
        overlay_lines: [
          `Buy a rental for ${dollars(buy)}`,
          `Cashflow: ${dollars(cashflow)} a month`,
          `That is ${dollars(cashflow * 12)} a year`,
          `Appreciation: ${appPct}% = ${dollars(appAmount)}`,
          `Total annual return beats most stocks`,
        ],
        closer_line: `I model both lines in Rent Roll.`,
        caption: `Cashflow pays the bills today. Appreciation builds the wealth tomorrow. You do not have to pick. Most rentals quietly do both if you bought right. Save this if you are still arguing with someone about which matters.`,
        hashtags: ['#realestateinvesting', '#cashflow', '#wealthbuilding', '#passiveincome', '#rentalproperty'],
        template_id: 'LOCAL-CFAPPR-001',
        controversy_level: controversy,
        audience,
        rationale: null,
      };
    },
  },

  // ---------- Off-market deal funnel ----------
  {
    id: 'LOCAL-OFFMKT-001',
    generate: ({ rng, audience, controversy }) => {
      const records = range(rng, 180, 320, 10);
      const cost = range(rng, 64, 134, 5);
      const callbacks = range(rng, 8, 18);
      const meetings = range(rng, 2, 5);
      const closes = range(rng, 1, 2);
      return {
        overlay_lines: [
          `Pull ${records} tired-owner records`,
          `Skip-trace cost: ${dollars(cost)} total`,
          `Cold-text by 10am: ${callbacks} callbacks`,
          `${meetings} site visits in week one`,
          `Lock ${closes} deal under ARV`,
        ],
        closer_line: `Every lead lives in Rent Roll.`,
        caption: `Deals are not rare. The willingness to text 200 strangers before noon is rare. Funnel math always wins over hoping. Save this if you keep waiting on Zillow.`,
        hashtags: ['#realestateinvesting', '#offmarketdeals', '#wholesaling', '#realestatetips', '#sidehustle'],
        template_id: 'LOCAL-OFFMKT-001',
        controversy_level: controversy,
        audience,
        rationale: null,
      };
    },
  },

  // ---------- First-rental beginner roadmap ----------
  {
    id: 'LOCAL-BEGIN-001',
    generate: ({ rng, audience, controversy }) => {
      const target = range(rng, 90, 145, 5) * 1000;
      const down = Math.round(target * 0.20);
      const closing = range(rng, 4, 8) * 1000;
      const reserves = range(rng, 4, 8) * 1000;
      const total = down + closing + reserves;
      return {
        overlay_lines: [
          `Step 1: Save ${dollars(total)} cash`,
          `Step 2: Find a ${dollars(target)} rental`,
          `Step 3: ${dollars(down)} down + ${dollars(closing)} closing`,
          `Step 4: Hold ${dollars(reserves)} in reserves`,
          `Step 5: Close in 30 days`,
        ],
        closer_line: `I built the map in Rent Roll.`,
        caption: `Most people overthink the first rental. The path is short and boring. Save the cash, find the deal, hold a reserve, sign the docs. That is it. Do not let analysis paralysis cost you 5 years.`,
        hashtags: ['#firsthome', '#realestate', '#realestatetips', '#investing', '#financialfreedom'],
        template_id: 'LOCAL-BEGIN-001',
        controversy_level: controversy,
        audience,
        rationale: null,
      };
    },
  },
];

/**
 * Pick a template that hasn't been used recently (recentTemplateIds), and
 * generate a hook from it. If all templates have been used recently, picks
 * one at random anyway.
 *
 * Exported for unit testing.
 */
export function pickTemplate(
  recentTemplateIds: string[],
  rng: () => number = Math.random,
): Template {
  const used = new Set(recentTemplateIds);
  const unused = TEMPLATES.filter(t => !used.has(t.id));
  const choose = unused.length > 0 ? unused : TEMPLATES;
  return choose[Math.floor(rng() * choose.length)]!;
}

/**
 * Generate a full LocalHook given context. Pure / deterministic given rng.
 */
export function generateLocalHook(
  topic: string,
  audience: string,
  controversy: number,
  recentTemplateIds: string[] = [],
  rng: () => number = Math.random,
): LocalHook {
  const tmpl = pickTemplate(recentTemplateIds, rng);
  return tmpl.generate({ topic, audience, controversy, rng });
}

/** Settings type alias used by the orchestrator. */
export type LocalHookSettings = Pick<BRollSettings, 'audience' | 'controversy'>;
