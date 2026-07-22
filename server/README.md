# ZZSocial API server

Node.js + Express API that stores ZZSocial data in PostgreSQL and proxies OpenRouter
(so your OpenRouter key never reaches the browser). Runs on your EC2 box alongside
Postgres. The frontend runs on your own machine and talks to this API.

## Prerequisites (on the EC2 instance)
- Node.js 18+  (`node -v`)
- PostgreSQL running locally on the instance

## 1. Create the database + user (once)
```bash
sudo -u postgres psql
```
```sql
CREATE DATABASE zzsocial;
CREATE USER zzsocial WITH PASSWORD 'a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE zzsocial TO zzsocial;
\q
```

## 2. Configure
```bash
cd server
cp .env.example .env
# edit .env: set PGPASSWORD, APP_TOKEN (long random), OPENROUTER_KEY,
#            and ALLOWED_ORIGIN (where you open the app, e.g. http://localhost:8777)
npm install
npm run init-db      # creates the tables
```

## 3. Run
```bash
npm start            # listens on PORT (default 3001)
```
Keep it running with a process manager (recommended):
```bash
sudo npm i -g pm2
pm2 start server.js --name zzsocial
pm2 save
```

## 4. Open the EC2 port
In the EC2 **security group**, allow inbound TCP on your `PORT` (3001).
Ideally restrict the source to your own IP.

## 5. Point the app at it
In the app's **Settings**:
- **Server URL:** `http://YOUR-EC2-PUBLIC-IP:3001`
- **App token:** the same `APP_TOKEN` from `.env`

Verify the server is reachable: `http://YOUR-EC2-IP:3001/api/health` → `{"ok":true}`.

## Endpoints
- `GET  /api/health` — liveness (no auth)
- `GET  /api/state` — persons + shared settings
- `PUT  /api/persons/:id` — upsert a person
- `DELETE /api/persons/:id` — delete a person
- `PUT  /api/settings` — upsert You-profile + style/emoji/model + active person
- `POST /api/ai/complete` — OpenRouter proxy (key added server-side)

All `/api/*` except `/api/health` require the `X-App-Token` header.

## Security notes
- Plain HTTP sends the token + data unencrypted. For real use, put this behind a
  reverse proxy with TLS (Caddy/Nginx + a domain) and use `https://` in the app.
- Keep the security group locked to your IP.
