// src/lib/types.ts

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
  tiktok: {
    uploadUrl: string;
    clickFirstLocationChip: boolean;
    aiGeneratedDisclosure: boolean;
    firstRunContentChecks: 'Cancel' | 'Turn on';
  };
  antiRepeat: {
    soundLastN: number;
  };
  retention: {
    downloadsKeepDays: number;
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

export interface TikTokResult {
  status: 'success' | 'dry-run-success';
  postedUrl?: string;
  soundName?: string;
  soundFallback: boolean;
  location?: string;
}
