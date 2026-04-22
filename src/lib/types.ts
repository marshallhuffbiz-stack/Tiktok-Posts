// src/lib/types.ts

export interface BRollSettings {
  category: string;
  minSec: number;
  maxSec: number;
  cropServerSide: boolean;
  generateText: boolean;
  audience: 'both' | 'landlord' | 'investor';
  controversy: 1 | 2 | 3 | 4 | 5;
  pullTrending: boolean;
  overlayRetries: number;
  /** Optional: add a TTS voice-over track to the silent Pexels clip. */
  voiceover?: {
    enabled?: boolean;
    voice?: string;     // macOS voice name; random pick if absent
    rate?: number;      // words per minute, default 175
  };
}

export interface Settings {
  schedule: string[]; // ["HH:MM", ...]
  rollSlides: {
    carousels: number;
    slidesEach: number;
    secPerSlide: number;
    outputMode: 'Video' | 'Images';
    styleMode: 'No BG' | 'Solid BG' | 'Semi BG' | 'Outline';
    textColor: string; // CSS color name or hex
    outlineColor: string;
    preset: string | null;
    font: string;
    size: string; // e.g. "52px"
    align: 'Left' | 'Center' | 'Right';
  };
  bRoll: BRollSettings;
  tiktok: {
    uploadUrl: string;
    clickFirstLocationChip: boolean;
    aiGeneratedDisclosure: boolean;
    firstRunContentChecks: 'Cancel' | 'Turn on';
    /** When true, click "Save draft" instead of "Post". Default: false. */
    saveAsDraft?: boolean;
    /** How to handle the location field.
     *  'skip' = don't touch it (recommended — random locations look bot-like)
     *  'random-chip' = old behavior: pick a random chip from TikTok's suggestions
     *  'search' = type the value of locationSearch into the location search box
     */
    locationMode?: 'skip' | 'random-chip' | 'search';
    /** Location name to type in the search box when locationMode='search'. */
    locationSearch?: string;
  };
  antiRepeat: {
    soundLastN: number;
  };
  retention: {
    downloadsKeepDays: number;
  };
  /** Optional posting cadence controls. */
  cadence?: {
    /** Probability (0-1) of skipping this slot when post.ts fires. Default: 0 (never skip). */
    skipProbability?: number;
    /** Hours of the day in which posts are allowed (0-23). Empty = all hours. */
    allowedHours?: number[];
  };
}

export type RunStatus =
  | 'success'
  | 'dry-run-success'
  | 'fail';

export type ErrorType =
  | 'roll-slides-timeout'
  | 'roll-slides-no-video'
  | 'tiktok-session-expired'
  | 'tiktok-upload-stuck'
  | 'tiktok-post-failed'
  | 'tiktok-account-flagged'
  | 'unknown-error';

export interface RunEntry {
  ts: string;                 // ISO 8601
  topic?: string;
  slug?: string;
  captionFirst80?: string;
  soundName?: string;
  soundFallback?: boolean;    // true if we used the "first For You" fallback
  location?: string;
  /** Pexels source URL (or other origin) of the B-roll clip. */
  sourceUrl?: string;
  /** Aspect ratio of the source clip (e.g. "1080x1920"). */
  aspectRatio?: string;
  /** Duration of the source clip in seconds. */
  clipDurationSec?: number;
  /** Hook template_id from the B-roll API (e.g., "INV-012"). */
  templateId?: string;
  /** Audience passed to the B-roll API for this run. */
  audience?: string;
  /** Controversy level passed to the B-roll API. */
  controversy?: number;
  status: RunStatus;
  durationMs: number;
  errorType?: ErrorType;
  errorMsg?: string;
}

export interface RollSlidesResult {
  videoPath: string;
  captionPath: string;
  caption: string;
  hashtags: string;
  slug: string;
  carouselTitle: string;
}

export interface BRollResult {
  videoPath: string;       // raw Pexels bitstream written to disk (stream-copied by rent-roll-slides; no re-encode)
  overlayPath: string;     // overlay.txt
  overlayText: string;     // loaded convenience copy
  captionPath: string;     // caption.txt
  caption: string;         // body + hashtags as will be pasted into TikTok
  hashtags: string;        // tags only, for the hashtag-entity commit loop
  slug: string;            // e.g. "garden", used in filenames — from sourceCategory
  clipDurationSec: number; // durationSec from API response
  aspectRatio: string;     // "WxH" parsed from processing string
  sourceUrl?: string;      // Original Pexels CDN URL (videos.pexels.com/...)
  templateId?: string;     // hook.template_id from the B-roll API
  /** The topic string we passed to the API for this generation. */
  chosenTopic?: string;
  /** The audience we passed to the API for this generation. */
  chosenAudience?: string;
  /** The controversy level we passed to the API. */
  chosenControversy?: number;
}

export interface TikTokResult {
  status: 'success' | 'dry-run-success';
  postedUrl?: string;
  soundName?: string;
  soundFallback: boolean;
  location?: string;
}
