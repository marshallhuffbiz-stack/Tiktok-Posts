// src/lib/voiceover.ts
//
// Add a TTS voice-over track to a silent Pexels clip without re-encoding
// the video. macOS `say` generates the AIFF audio; ffmpeg mux'es it into
// the mp4 with `-c:v copy` so the original Pexels h264 bitstream is
// preserved (authenticity intact). Only the audio track is encoded fresh
// (AAC), and audio fingerprints don't carry the same algorithmic weight
// as video container metadata.
//
// Why we want voice:
// - TikTok's algorithm explicitly prioritises content with audio track
// - Silent videos (h264/no-audio per Pexels) get suppressed reach
// - Voice content on POV-style clips matches the niche-creator pattern
//
// Voice rotation (Samantha / Alex / Karen) breaks the "same TTS every post"
// fingerprint that simple TTS injection would create.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface VoiceoverOptions {
  /** macOS voice name. Random pick from VOICES if not set. */
  voice?: string;
  /** Words-per-minute (175 = standard, 200 = brisker, 150 = slower). */
  rate?: number;
  /** Where to write intermediate AIFF (auto-cleaned after mux). */
  workDir?: string;
}

/** Curated set of macOS voices that sound natural enough for short hooks. */
export const VOICES = ['Samantha', 'Alex', 'Karen', 'Daniel', 'Ava'] as const;

export class VoiceoverFailed extends Error {
  constructor(stage: string, detail: string) {
    super(`voiceover ${stage} failed: ${detail}`);
    this.name = 'VoiceoverFailed';
  }
}

/**
 * Strip overlay text down to what should actually be spoken. The closer
 * line ("It's called the X.") often reads awkwardly out loud, so we keep
 * the body but optionally drop overly-numeric repetition.
 *
 * Exported for unit testing.
 */
export function speakableText(overlayText: string): string {
  // 1. Strip $ entirely — TTS reads numbers fine without currency prefix
  // 2. Convert "118k" → "118 thousand" so TTS doesn't read "k" as letter
  // 3. Collapse whitespace
  const t = overlayText
    .replace(/\$/g, '')
    .replace(/(\d+(?:\.\d+)?)k\b/gi, '$1 thousand')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/**
 * Run macOS `say` to generate AIFF audio. Returns the AIFF path.
 */
function synthesize(text: string, voice: string, rate: number, outAiff: string): void {
  const result = spawnSync('say', ['-v', voice, '-r', String(rate), '-o', outAiff, text], {
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new VoiceoverFailed('say', `exit ${result.status}: ${result.stderr.toString().slice(0, 200)}`);
  }
  if (!fs.existsSync(outAiff) || fs.statSync(outAiff).size === 0) {
    throw new VoiceoverFailed('say', 'output AIFF empty');
  }
}

/**
 * Mux audio into video without touching the video bitstream.
 *
 * - `-c:v copy` keeps the Pexels h264 stream byte-for-byte
 * - `-c:a aac -b:a 96k` encodes the new audio at modest bitrate (~10 KB/s)
 * - `-shortest` truncates audio to video length (so longer narration
 *   doesn't extend the video duration)
 * - `-movflags use_metadata_tags` keeps existing container metadata
 */
function muxAudio(videoPath: string, audioPath: string, outVideo: string): void {
  const result = spawnSync('ffmpeg', [
    '-y', '-i', videoPath, '-i', audioPath,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '96k',
    '-map', '0:v:0', '-map', '1:a:0',
    '-shortest',
    '-movflags', 'use_metadata_tags',
    outVideo,
  ], { timeout: 90_000 });
  if (result.status !== 0) {
    throw new VoiceoverFailed('ffmpeg', `exit ${result.status}: ${result.stderr.toString().slice(0, 300)}`);
  }
  if (!fs.existsSync(outVideo) || fs.statSync(outVideo).size === 0) {
    throw new VoiceoverFailed('ffmpeg', 'output mp4 empty');
  }
}

/**
 * Add a TTS voice-over to a silent video. Returns the path to the new
 * voiced mp4. Original videoPath is not modified.
 *
 * The new file lives next to the original with `.voiced.mp4` suffix.
 * On any failure, throws VoiceoverFailed — caller decides whether to
 * fall back to the silent original.
 */
export function addVoiceover(
  videoPath: string, overlayText: string, opts: VoiceoverOptions = {},
): string {
  const text = speakableText(overlayText);
  if (!text || text.length < 3) {
    throw new VoiceoverFailed('input', 'no speakable text');
  }
  const voice = opts.voice ?? VOICES[Math.floor(Math.random() * VOICES.length)]!;
  const rate = opts.rate ?? 175;
  const workDir = opts.workDir ?? path.dirname(videoPath);

  const aiffPath = path.join(workDir, `${path.basename(videoPath, '.mp4')}.tts.aiff`);
  const outVideo = videoPath.replace(/\.mp4$/, '.voiced.mp4');

  synthesize(text, voice, rate, aiffPath);
  try {
    muxAudio(videoPath, aiffPath, outVideo);
  } finally {
    // Best-effort cleanup of intermediate AIFF
    try { fs.unlinkSync(aiffPath); } catch { /* ignore */ }
  }
  console.log(`[voiceover] added (voice=${voice} rate=${rate}) → ${path.basename(outVideo)}`);
  return outVideo;
}
