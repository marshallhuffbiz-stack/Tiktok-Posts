// src/lib/sanitizeVideo.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Re-encodes the input MP4 with Apple's videotoolbox hardware encoder and
 * Apple-style metadata, masking the libx264/Lavc fingerprint that TikTok
 * uses to identify FFmpeg-generated content. Returns the path to the new
 * MP4 (sibling to the input, with `.sanitized.mp4` suffix).
 *
 * If ffmpeg isn't installed or the re-encode fails, returns the original
 * input path and writes a warning to stderr — so the script keeps working
 * (just without the anti-detection benefit).
 */
export function sanitizeVideo(inputPath: string): string {
  // Quick check: is ffmpeg available?
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (which.status !== 0) {
    console.warn('[sanitizeVideo] ffmpeg not installed — skipping. Install with: brew install ffmpeg');
    return inputPath;
  }

  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, '.mp4');
  const outputPath = path.join(dir, `${base}.sanitized.mp4`);

  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const args = [
    '-y',                                          // overwrite output
    '-i', inputPath,
    '-c:v', 'h264_videotoolbox',                   // Apple HW encoder (NOT libx264)
    '-b:v', '4M',                                  // bitrate
    '-pix_fmt', 'yuv420p',                         // standard pixel format
    '-c:a', 'copy',                                // copy audio if any (the original has none usually)
    '-movflags', '+faststart',                     // optimize for streaming
    '-map_metadata', '-1',                         // strip ALL existing metadata
    '-metadata', 'com.apple.quicktime.make=Apple',
    '-metadata', 'com.apple.quicktime.model=iPhone 15',
    '-metadata', 'com.apple.quicktime.software=18.0',
    '-metadata', `com.apple.quicktime.creationdate=${nowIso}`,
    '-metadata', `creation_time=${nowIso}`,
    outputPath,
  ];

  const proc = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (proc.status !== 0) {
    console.warn('[sanitizeVideo] ffmpeg failed — keeping original.');
    console.warn(proc.stderr?.slice(0, 500));
    return inputPath;
  }
  // Verify output exists and is non-empty
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
    console.warn('[sanitizeVideo] output missing or too small — keeping original.');
    return inputPath;
  }
  return outputPath;
}
