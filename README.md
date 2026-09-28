# n8n Upload Gateway

Kleine Webanwendung: Du lädst eine PDF- oder Bilddatei per Drag-and-Drop (oder Dateiauswahl) hoch, die App nimmt die Datei entgegen und leitet sie per HTTP-POST an einen **n8n-Webhook** weiter.

## Funktionsweise

```
Browser  --(Upload)-->  Node/Express-Server  --(multipart/form-data)-->  n8n-Webhook
```

- Frontend: einfache HTML/CSS/JS-Seite mit Drag-and-Drop-Upload, Fortschrittsanzeige und Statusmeldung.
- Backend: Express-Server mit `multer` (nimmt die Datei entgegen, validiert Typ/Größe) und `axios` + `form-data` (leitet die Datei an n8n weiter).
- Erlaubte Dateitypen: PDF, PNG, JPG/JPEG, WEBP, GIF (Standard: max. 20 MB, in `.env` änderbar).
- Die Datei wird nur kurz temporär auf dem Server abgelegt und nach der Weiterleitung sofort wieder gelöscht.

## Voraussetzungen

- Node.js 20+ (lokal) **oder** Docker
- Ein n8n-Workflow mit einem **Webhook-Trigger-Node** (Methode: `POST`), der Dateien via `multipart/form-data` unter dem Feldnamen `file` entgegennimmt.

## Einrichtung

1. Repository klonen und ins Verzeichnis wechseln.
2. `.env` aus der Vorlage erstellen:
   ```bash
   cp .env.example .env
   ```
3. In `.env` die Webhook-URL deines n8n-Workflows eintragen:
   ```
   N8N_WEBHOOK_URL=http://<deine-n8n-instanz>:5678/webhook/upload
   ```

## Lokal starten (ohne Docker)

```bash
npm install
npm start
```

Die App läuft danach auf [http://localhost:3000](http://localhost:3000).

## Mit Docker starten

```bash
docker compose up -d --build
```

Läuft anschließend ebenfalls auf Port `3000`. Falls die App im selben Docker-Netzwerk wie dein bestehender n8n-Stack laufen soll (z.B. dein `n8n-heimserver-docker`-Setup), die entsprechenden Zeilen in `docker-compose.yml` auskommentieren und das Netzwerk anpassen — dann kannst du in `N8N_WEBHOOK_URL` den Container-Namen von n8n statt einer IP/Domain verwenden.

## n8n-Workflow (Beispiel)

1. **Webhook-Node**: HTTP-Methode `POST`, Pfad z.B. `/upload`, "Binary Data" aktivieren, Feldname `file`.
2. Danach beliebige Verarbeitung (z.B. Datei speichern, OCR, an Telegram/Discord weiterleiten, in eine Datenbank ablegen, etc.).
3. Die Webhook-URL aus n8n (Test- oder Produktiv-URL) in die `.env` dieser App eintragen.

Optional werden zusätzlich zur Datei folgende Formularfelder mitgeschickt, die du im n8n-Workflow weiterverarbeiten kannst:
- `originalName`
- `mimeType`
- `size`
- `uploadedAt`

## Optionale Absicherung des Webhooks

Falls dein n8n-Webhook per Header-Token abgesichert ist, können in `.env` zusätzlich gesetzt werden:

```
N8N_AUTH_HEADER_NAME=X-Webhook-Token
N8N_AUTH_HEADER_VALUE=dein-geheimes-token
```

Diese werden dann bei jeder Weiterleitung als HTTP-Header mitgeschickt.

## Health-Check

```
GET /health
```

Gibt zurück, ob der Server läuft und ob `N8N_WEBHOOK_URL` konfiguriert ist.
