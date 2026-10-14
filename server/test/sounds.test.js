const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateSoundName, sniffMatches, seedSounds, listSounds } = require('../sounds');

test('validates sound names', () => {
  for (const ok of ['bell.mp3', 'S door-1_x.OGG', 'a.wav']) assert.strictEqual(validateSoundName(ok), null, ok);
  for (const bad of ['', '.hidden.mp3', '../x.mp3', 'a/b.mp3', 'a\\b.mp3', 'x.txt', 'noext', 'a..b.mp3', 'é.mp3', 'a'.repeat(97) + '.mp3', null, 5]) {
    assert.ok(validateSoundName(bad), String(bad));
  }
  assert.strictEqual(validateSoundName('a'.repeat(96) + '.mp3'), null);
});

test('sniffs magic bytes', () => {
  assert.ok(sniffMatches(Buffer.from('ID3\x04rest'), '.mp3'));
  assert.ok(sniffMatches(Buffer.from([0xff, 0xfb, 0x90, 0x00]), '.mp3'));
  assert.ok(sniffMatches(Buffer.from([0xff, 0xf3, 0x90, 0x00]), '.mp3'));
  assert.ok(!sniffMatches(Buffer.from('<html>'), '.mp3'));
  assert.ok(sniffMatches(Buffer.from('OggSxxxx'), '.ogg'));
  assert.ok(!sniffMatches(Buffer.from('OggSxxxx'), '.wav'));
  assert.ok(sniffMatches(Buffer.from('RIFF\0\0\0\0WAVEfmt '), '.wav'));
  assert.ok(!sniffMatches(Buffer.from('RIFF\0\0\0\0AVI LIST'), '.wav'));
  assert.ok(!sniffMatches(Buffer.alloc(2), '.mp3'));
});

test('seeds defaults once and never overwrites', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sounds-'));
  const dir = path.join(tmp, 'sounds');
  assert.strictEqual(seedSounds(dir), true);
  const files = listSounds(dir);
  assert.strictEqual(files.length, 7);
  assert.deepStrictEqual(files.map((f) => f.file), files.map((f) => f.file).sort((a, b) => a.localeCompare(b)));
  fs.writeFileSync(path.join(dir, 'bell.mp3'), 'mine');
  fs.unlinkSync(path.join(dir, 'bell_alert_3.mp3'));
  assert.strictEqual(seedSounds(dir), false); // dir exists: untouched
  assert.strictEqual(fs.readFileSync(path.join(dir, 'bell.mp3'), 'utf8'), 'mine');
  assert.strictEqual(listSounds(dir).length, 6);
  fs.rmSync(tmp, { recursive: true });
});
