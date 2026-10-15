/**
 * Sound library routes: /api/sounds. Files live in <data dir>/sounds and are
 * seeded on first start from server/default-sounds. See docs/guard-panel-spec.md §4.2.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const MAX_BYTES = 2 * 1024 * 1024;
const NAME_RE = /^[A-Za-z0-9 ._-]+$/;
const TYPES = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const DEFAULT_DIR = path.join(__dirname, 'default-sounds');

/** Returns an error message, or null when `name` is a safe sound file name. */
function validateSoundName(name) {
  if (typeof name !== 'string' || !name) return 'File name is required';
  if (name.length > 100) return 'File name must be 100 characters or fewer';
  if (name.startsWith('.')) return 'File name must not start with a dot';
  if (!NAME_RE.test(name)) return 'File name may only contain letters, digits, space, dot, underscore and hyphen';
  if (name.includes('..')) return 'File name must not contain ".."';
  if (!TYPES[path.extname(name).toLowerCase()]) return 'File extension must be .mp3, .ogg or .wav';
  return null;
}

/** True if the bytes look like the type implied by the extension. */
function sniffMatches(buf, ext) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  switch (ext.toLowerCase()) {
    case '.mp3':
      return buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    case '.ogg':
      return buf.toString('latin1', 0, 4) === 'OggS';
    case '.wav':
      return buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE';
    default:
      return false;
  }
}

/** Creates the sounds dir and copies defaults into it if it doesn't exist yet. Never overwrites. */
function seedSounds(dir, defaultsDir = DEFAULT_DIR) {
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(defaultsDir)) {
    for (const f of fs.readdirSync(defaultsDir)) {
      if (validateSoundName(f)) continue;
      const dest = path.join(dir, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(defaultsDir, f), dest);
    }
  }
  return true;
}

function listSounds(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => !validateSoundName(f))
    .map((file) => ({ file, size: fs.statSync(path.join(dir, file)).size }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function register(app, { dataDir }) {
  const dir = () => path.join(dataDir(), 'sounds');
  try { seedSounds(dir()); } catch (e) { console.error('Could not seed sound library:', e.message); }

  const rawBody = express.raw({ type: () => true, limit: MAX_BYTES });

  app.get('/api/sounds', (_req, res) => {
    res.json(listSounds(dir()));
  });

  app.get('/api/sounds/:file', (req, res) => {
    const name = req.params.file;
    if (validateSoundName(name)) return res.status(400).json({ error: 'Invalid sound name' });
    const full = path.join(dir(), name);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Sound not found' });
    res.set('Content-Type', TYPES[path.extname(name).toLowerCase()]);
    res.set('Cache-Control', 'public, max-age=300');
    res.send(fs.readFileSync(full));
  });

  app.post('/api/sounds', (req, res, next) => {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BYTES) return res.status(413).json({ error: 'File is larger than 2 MB' });
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!(ct.startsWith('audio/') || ct === 'application/octet-stream')) {
      return res.status(415).json({ error: 'Content-Type must be audio/* or application/octet-stream' });
    }
    rawBody(req, res, (err) => {
      if (err) {
        if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File is larger than 2 MB' });
        return next(err);
      }
      const name = req.query.name;
      const nameErr = validateSoundName(name);
      if (nameErr) return res.status(400).json({ error: nameErr });
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'Empty upload' });
      if (!sniffMatches(body, path.extname(name))) {
        return res.status(400).json({ error: 'File contents do not match its extension (expected MP3, OGG or WAV audio)' });
      }
      fs.mkdirSync(dir(), { recursive: true });
      const full = path.join(dir(), name);
      if (fs.existsSync(full) && req.query.overwrite !== '1') {
        return res.status(409).json({ error: `"${name}" already exists` });
      }
      const tmp = `${full}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, full);
      res.status(201).json({ file: name, size: body.length });
    });
  });

  app.delete('/api/sounds/:file', (req, res) => {
    const name = req.params.file;
    if (validateSoundName(name)) return res.status(400).json({ error: 'Invalid sound name' });
    const full = path.join(dir(), name);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Sound not found' });
    fs.unlinkSync(full);
    res.json({ ok: true });
  });
}

module.exports = { register, validateSoundName, sniffMatches, seedSounds, listSounds, MAX_BYTES };
