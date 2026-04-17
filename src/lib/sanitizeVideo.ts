// src/lib/sanitizeVideo.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Two-pass MP4 sanitization to mask the FFmpeg fingerprint:
 *
 * Pass 1 — re-encode with Apple's h264_videotoolbox HW encoder.
 *   - Apple-style ftyp brand (mp42)
 *   - moov AT END (NOT faststart — iPhones don't faststart, that's a tell)
 *   - Apple metadata fields where ffmpeg accepts them
 *
 * Pass 2 — copy-remux to strip the residual `encoder=Lavc...` tag that
 *   ffmpeg writes to the udta atom on every encode pass. The copy pass
 *   doesn't re-encode (fast, lossless) but lets us pass `-map_metadata -1`
 *   to drop ffmpeg's writes.
 *
 * Returns the path to the sanitized MP4 (or the original if ffmpeg fails).
 */
export function sanitizeVideo(inputPath: string): string {
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (which.status !== 0) {
    console.warn('[sanitizeVideo] ffmpeg not installed — skipping. Install via: brew install ffmpeg');
    return inputPath;
  }

  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, '.mp4');
  const passOne = path.join(dir, `${base}.pass1.mp4`);
  const finalPath = path.join(dir, `${base}.sanitized.mp4`);

  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // Pass 1: encode with Apple HW encoder, no faststart.
  const pass1Args = [
    '-y',
    '-i', inputPath,
    '-c:v', 'h264_videotoolbox',
    '-b:v', '4M',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    // NO -movflags +faststart — iPhone places moov at the END of the
    // file (after mdat); ffmpeg defaults match. faststart moves moov to
    // the front, which is itself a programmatic tell.
    '-brand', 'mp42',  // Apple's primary ftyp brand
    '-map_metadata', '-1',
    '-metadata', `creation_time=${nowIso}`,
    passOne,
  ];
  const p1 = spawnSync('ffmpeg', pass1Args, { encoding: 'utf8' });
  if (p1.status !== 0) {
    console.warn('[sanitizeVideo] pass 1 failed — keeping original.');
    console.warn(p1.stderr?.slice(0, 400));
    return inputPath;
  }
  if (!fs.existsSync(passOne) || fs.statSync(passOne).size < 1024) {
    console.warn('[sanitizeVideo] pass 1 output missing — keeping original.');
    return inputPath;
  }

  // Pass 2: remux (no re-encode) and strip metadata.
  // This drops the residual `encoder=Lavc...` tag that pass 1 still writes.
  const pass2Args = [
    '-y',
    '-i', passOne,
    '-c', 'copy',
    '-map_metadata', '-1',
    '-brand', 'mp42',
    finalPath,
  ];
  const p2 = spawnSync('ffmpeg', pass2Args, { encoding: 'utf8' });

  // Clean up pass 1 file regardless of pass 2 result.
  try { fs.unlinkSync(passOne); } catch { /* ignore */ }

  if (p2.status !== 0) {
    console.warn('[sanitizeVideo] pass 2 (remux) failed — keeping original.');
    console.warn(p2.stderr?.slice(0, 400));
    return inputPath;
  }
  if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 1024) {
    console.warn('[sanitizeVideo] pass 2 output missing — keeping original.');
    return inputPath;
  }
  return finalPath;
}
