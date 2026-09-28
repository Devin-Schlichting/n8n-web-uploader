require('dotenv').config();

const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

const app = express();

const PORT = process.env.PORT || 3000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 20);
const AUTH_HEADER_NAME = process.env.N8N_AUTH_HEADER_NAME;
const AUTH_HEADER_VALUE = process.env.N8N_AUTH_HEADER_VALUE;

if (!N8N_WEBHOOK_URL) {
  console.warn(
    '[WARN] N8N_WEBHOOK_URL ist nicht gesetzt. Bitte .env anlegen (siehe .env.example).'
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
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Nur PDF- und Bilddateien (PNG, JPG, WEBP, GIF) sind erlaubt.'));
    }
  },
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', webhookConfigured: Boolean(N8N_WEBHOOK_URL) });
});

app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Keine Datei erhalten.' });
    }
    if (!N8N_WEBHOOK_URL) {
      return res
        .status(500)
        .json({ success: false, error: 'N8N_WEBHOOK_URL ist auf dem Server nicht konfiguriert.' });
    }

    const filePath = req.file.path;

    try {
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
      res.status(502).json({
        success: false,
        error: 'Weiterleitung an n8n fehlgeschlagen.',
        details: forwardError.message,
      });
    } finally {
      // Temporäre Datei wieder löschen, sobald sie weitergeleitet wurde
      fs.unlink(filePath, () => {});
    }
  });
});

app.listen(PORT, () => {
  console.log(`n8n-upload-gateway läuft auf http://localhost:${PORT}`);
});
