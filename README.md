# n8n Upload Gateway

Kleine Webanwendung: Du lädst eine PDF- oder Bilddatei per Drag-and-Drop (oder Dateiauswahl) hoch, die App nimmt die Datei entgegen und leitet sie per HTTP-POST an einen **n8n-Webhook** weiter.

## Funktionsweise

```
Browser  --(Upload)-->  Node/Express-Server  --(multipart/form-data)-->  n8n-Webhook
```

- Frontend: einfache HTML/CSS/JS-Seite mit Drag-and-Drop-Upload, Fortschrittsanzeige und Statusmeldung.
- Backend: Express-Server mit `multer` (nimmt die Datei entgegen, validiert Typ/Größe) und `axios` + `form-data` (leitet die Datei an n8n weiter).
- Erlaubte Dateitypen: PDF, PNG, JPG/JPEG, WEBP, GIF (Standard: max. 50 MB, in `.env` über `MAX_FILE_SIZE_MB` änderbar – die Anzeige im Frontend passt sich automatisch an).
- Die Datei wird nur kurz temporär auf dem Server abgelegt und nach der Weiterleitung sofort wieder gelöscht (auch wenn die Weiterleitung fehlschlägt).
- Dateinamen mit Umlauten (z.B. `Übersicht.pdf`) kommen korrekt bei n8n an.

## Voraussetzungen

- Node.js 20+ (lokal) **oder** Docker
- Ein n8n-Workflow mit einem **Webhook-Trigger-Node** (Methode: `POST`), der Dateien via `multipart/form-data` unter dem Feldnamen `file` entgegennimmt.

## Einrichtung

1. Repository klonen und ins Verzeichnis wechseln.
2. `.env` aus der Vorlage erstellen:
   ```bash
   cp .env.example .env
   ```
3. In `.env` die Webhook-URL deines n8n-Workflows eintragen (siehe [Welche Webhook-URL?](#welche-webhook-url)).

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

Läuft anschließend ebenfalls auf Port `3000` (bzw. dem Port aus `PORT` in der `.env`). Im Container läuft die App immer auf Port 3000, `PORT` bestimmt nur den Port auf dem Host.

Die `.env` wird nicht ins Image kopiert (siehe `.dockerignore`), sondern erst beim Start über `env_file` eingelesen.

## Welche Webhook-URL?

**Wichtig bei Docker:** Im Container zeigt `localhost` auf den Container selbst, nicht auf n8n. `http://localhost:5678/...` funktioniert deshalb nur, wenn die App **ohne** Docker läuft.

| Setup | `N8N_WEBHOOK_URL` |
|---|---|
| Docker, n8n läuft auf demselben Host und veröffentlicht Port 5678 | `http://host.docker.internal:5678/webhook/upload` |
| Docker, im selben Docker-Netzwerk wie der n8n-Container (z.B. dein `n8n-heimserver-docker`-Setup) | `http://n8n:5678/webhook/upload` |
| Ohne Docker (`npm start`) auf demselben Rechner wie n8n | `http://localhost:5678/webhook/upload` |
| n8n auf einem anderen Rechner / hinter einer Domain | `https://n8n.example.com/webhook/upload` |

Für die Variante „selbes Docker-Netzwerk“ die `networks`-Zeilen in `docker-compose.yml` einkommentieren und den Netzwerknamen anpassen; `n8n` ist dann der Container- bzw. Service-Name deines n8n.

**Test-URL vs. Produktiv-URL:** n8n zeigt im Webhook-Node zwei URLs an. Die Test-URL (`/webhook-test/...`) funktioniert nur, solange du im n8n-Editor auf „Listen for test event“ geklickt hast – danach schlägt jeder Upload fehl. Für den Dauerbetrieb die Produktiv-URL (`/webhook/...`) verwenden und den Workflow **aktivieren**. Die App warnt beim Start, wenn eine Test-URL eingetragen ist.

## n8n-Workflow (Beispiel)

1. **Webhook-Node**: HTTP-Methode `POST`, Pfad z.B. `/upload`, "Binary Data" aktivieren, Feldname `file`.
2. Danach beliebige Verarbeitung (z.B. Datei speichern, OCR, an Telegram/Discord weiterleiten, in eine Datenbank ablegen, etc.).
3. Workflow aktivieren und die Produktiv-URL aus n8n in die `.env` dieser App eintragen.

Optional werden zusätzlich zur Datei folgende Formularfelder mitgeschickt, die du im n8n-Workflow weiterverarbeiten kannst:
- `originalName`
- `mimeType`
- `size`
- `uploadedAt`

## Konfiguration (`.env`)

| Variable | Standard | Beschreibung |
|---|---|---|
| `N8N_WEBHOOK_URL` | – | Webhook-URL, an die weitergeleitet wird (Pflicht) |
| `N8N_AUTH_HEADER_NAME` / `N8N_AUTH_HEADER_VALUE` | – | Optionaler Header für abgesicherte Webhooks |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | – | Optionaler Login für die Upload-Seite |
| `PORT` | `3000` | Port der App (bei Docker: Port auf dem Host) |
| `MAX_FILE_SIZE_MB` | `50` | Maximale Dateigröße |
| `N8N_TIMEOUT_SECONDS` | `120` | Wie lange höchstens auf eine Antwort von n8n gewartet wird |

## Optionale Absicherung des Webhooks

Falls dein n8n-Webhook per Header-Token abgesichert ist, können in `.env` zusätzlich gesetzt werden:

```
N8N_AUTH_HEADER_NAME=X-Webhook-Token
N8N_AUTH_HEADER_VALUE=dein-geheimes-token
```

Diese werden dann bei jeder Weiterleitung als HTTP-Header mitgeschickt.

## Zugriffsschutz für die Upload-Seite

Ohne weitere Einstellung kann jeder, der die App erreicht, Dateien an deinen n8n-Workflow schicken. Im Heimnetz ist das meist in Ordnung. Sobald die Seite aus dem Internet erreichbar ist, in `.env` einen Login setzen:

```
BASIC_AUTH_USER=admin
BASIC_AUTH_PASSWORD=ein-langes-passwort
```

Der Browser fragt dann beim Aufruf nach Benutzername und Passwort. Ohne HTTPS (z.B. über einen Reverse Proxy) wird das Passwort allerdings unverschlüsselt übertragen. `/health` bleibt ohne Login erreichbar.

## Reverse Proxy

Läuft die App (oder n8n) hinter einem Reverse Proxy, muss dieser Uploads bis zur eingestellten Größe durchlassen. Bei nginx ist der Standard nur 1 MB, z.B.:

```
client_max_body_size 50m;
```

## Health-Check

```
GET /health
```

Gibt zurück, ob der Server läuft und ob `N8N_WEBHOOK_URL` konfiguriert ist.
