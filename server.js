require('dotenv').config();

const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 50);
const N8N_TIMEOUT_SECONDS = Number(process.env.N8N_TIMEOUT_SECONDS || 120);
const AUTH_HEADER_NAME = process.env.N8N_AUTH_HEADER_NAME;
const AUTH_HEADER_VALUE = process.env.N8N_AUTH_HEADER_VALUE;
const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER;
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD;

if (!N8N_WEBHOOK_URL) {
  console.warn(
    '[WARN] N8N_WEBHOOK_URL ist nicht gesetzt. Bitte .env anlegen (siehe .env.example).'
  );
} else if (N8N_WEBHOOK_URL.includes('/webhook-test/')) {
  console.warn(
    '[WARN] N8N_WEBHOOK_URL ist eine n8n-Test-URL (/webhook-test/). Diese funktioniert nur, ' +
      'solange im n8n-Editor "Listen for test event" aktiv ist. Für den Dauerbetrieb die ' +
      'Produktiv-URL (/webhook/) verwenden und den Workflow aktivieren.'
  );
}

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Erlaubte Dateitypen: PDF und gängige Bildformate
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${timestamp}-${safeName}`);
    },
  }),
  // Browser schicken Dateinamen als UTF-8; ohne diese Option kämen Umlaute kaputt an
  defParamCharset: 'utf8',
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Nur PDF- und Bilddateien (PNG, JPG, WEBP, GIF) sind erlaubt.'));
    }
  },
});

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Optionaler Zugriffsschutz per HTTP Basic Auth (nur aktiv, wenn beide Variablen gesetzt sind)
function basicAuth(req, res, next) {
  if (!BASIC_AUTH_USER || !BASIC_AUTH_PASSWORD) return next();

  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (separator !== -1 && safeEqual(user, BASIC_AUTH_USER) && safeEqual(password, BASIC_AUTH_PASSWORD)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="n8n Upload", charset="UTF-8"');
  res.status(401).send('Anmeldung erforderlich.');
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', webhookConfigured: Boolean(N8N_WEBHOOK_URL) });
});

app.use(basicAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ maxFileSizeMb: MAX_FILE_SIZE_MB });
});

app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res
          .status(413)
          .json({ success: false, error: `Datei ist zu groß (max. ${MAX_FILE_SIZE_MB} MB).` });
      }
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Keine Datei erhalten.' });
    }

    const filePath = req.file.path;

    try {
      if (!N8N_WEBHOOK_URL) {
        return res
          .status(500)
          .json({ success: false, error: 'N8N_WEBHOOK_URL ist auf dem Server nicht konfiguriert.' });
      }

      const form = new FormData();
      form.append('file', fs.createReadStream(filePath), {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });
      form.append('originalName', req.file.originalname);
      form.append('mimeType', req.file.mimetype);
      form.append('size', String(req.file.size));
      form.append('uploadedAt', new Date().toISOString());

      const headers = { ...form.getHeaders() };
      if (AUTH_HEADER_NAME && AUTH_HEADER_VALUE) {
        headers[AUTH_HEADER_NAME] = AUTH_HEADER_VALUE;
      }

      const response = await axios.post(N8N_WEBHOOK_URL, form, {
        headers,
        timeout: N8N_TIMEOUT_SECONDS * 1000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      res.json({
        success: true,
        message: 'Datei erfolgreich an n8n weitergeleitet.',
        n8nStatus: response.status,
        n8nResponse: response.data,
      });
    } catch (forwardError) {
      console.error('Fehler beim Weiterleiten an n8n:', forwardError.message);
      const timedOut = ['ECONNABORTED', 'ETIMEDOUT'].includes(forwardError.code);
      res.status(timedOut ? 504 : 502).json({
        success: false,
        error: timedOut
          ? `n8n hat nicht innerhalb von ${N8N_TIMEOUT_SECONDS} Sekunden geantwortet.`
          : 'Weiterleitung an n8n fehlgeschlagen.',
        details: forwardError.message,
      });
    } finally {
      // Temporäre Datei wieder löschen, egal ob die Weiterleitung geklappt hat
      fs.unlink(filePath, () => {});
    }
  });
});

app.listen(PORT, () => {
  console.log(`n8n-upload-gateway läuft auf http://localhost:${PORT}`);
});
