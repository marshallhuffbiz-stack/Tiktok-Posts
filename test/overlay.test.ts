import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSelectors, SelectorsNotConfigured, type EditorSelectors } from '../src/lib/overlay.js';

const validSelectors: EditorSelectors = {
  editorEntryButton: 'button.enter-editor',
  editorModalRoot: '.editor-modal',
  textTool: '[data-tool="text"]',
  textInput: '.text-input',
  selectedTextClip: '.text-clip.selected',
  timelineRoot: '.timeline',
  timelineHandle: '.timeline-handle',
  editorSaveButton: 'button.save',
};

function writeTmp(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-selectors-'));
  const p = path.join(dir, 'selectors.json');
  fs.writeFileSync(p, contents);
  return p;
}

test('loadSelectors returns all required fields when present', () => {
  const p = writeTmp(JSON.stringify(validSelectors));
  const loaded = loadSelectors(p);
  assert.equal(loaded.editorEntryButton, validSelectors.editorEntryButton);
  assert.equal(loaded.timelineHandle, validSelectors.timelineHandle);
  assert.equal(loaded.editorSaveButton, validSelectors.editorSaveButton);
});

test('loadSelectors accepts optional fields when present', () => {
  const p = writeTmp(JSON.stringify({ ...validSelectors, durationInput: 'input.dur', fitToVideoButton: 'button.fit' }));
  const loaded = loadSelectors(p);
  assert.equal(loaded.durationInput, 'input.dur');
  assert.equal(loaded.fitToVideoButton, 'button.fit');
});

test('loadSelectors throws SelectorsNotConfigured if file missing', () => {
  assert.throws(
    () => loadSelectors('/tmp/definitely-does-not-exist-overlay-selectors.json'),
    (err: Error) => err instanceof SelectorsNotConfigured && /config file not found/.test(err.message),
  );
});

test('loadSelectors throws SelectorsNotConfigured if JSON invalid', () => {
  const p = writeTmp('{ this is not json');
  assert.throws(
    () => loadSelectors(p),
    (err: Error) => err instanceof SelectorsNotConfigured && /not valid JSON/.test(err.message),
  );
});

test('loadSelectors throws SelectorsNotConfigured if required field missing', () => {
  const { editorEntryButton, ...rest } = validSelectors; void editorEntryButton;
  const p = writeTmp(JSON.stringify(rest));
  assert.throws(
    () => loadSelectors(p),
    (err: Error) => err instanceof SelectorsNotConfigured && /editorEntryButton/.test(err.message),
  );
});

test('loadSelectors throws if required field is empty string', () => {
  const p = writeTmp(JSON.stringify({ ...validSelectors, textInput: '' }));
  assert.throws(
    () => loadSelectors(p),
    (err: Error) => err instanceof SelectorsNotConfigured && /textInput/.test(err.message),
  );
});
