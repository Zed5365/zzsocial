/* ZZSocial API server
 * - Postgres persistence for persons + shared settings
 * - OpenRouter proxy (key stays server-side)
 * Requires Node 18+ (global fetch).
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3001;
const APP_TOKEN = process.env.APP_TOKEN || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Use DATABASE_URL if provided, else fall back to individual PG* env vars.
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {}
);

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(","),
    allowedHeaders: ["Content-Type", "X-App-Token"],
    methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
  })
);

// Health check (no auth) so you can verify the server is up.
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Token gate for everything else under /api.
app.use("/api", (req, res, next) => {
  if (!APP_TOKEN) return next(); // no token configured -> open (not recommended)
  if (req.get("X-App-Token") === APP_TOKEN) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

// ---- State ----
app.get("/api/state", async (_req, res) => {
  try {
    const persons = await pool.query(
      "SELECT id, name, profile, messages, summary FROM persons ORDER BY position ASC, updated_at ASC"
    );
    const s = await pool.query(
      "SELECT own_profile, style, emojis, model, active_person_id FROM app_settings WHERE id = 1"
    );
    const row = s.rows[0] || {};
    res.json({
      persons: persons.rows,
      settings: {
        ownProfile: row.own_profile || {},
        style: row.style || "natural",
        emojis: !!row.emojis,
        model: row.model || "anthropic/claude-sonnet-4.5",
        activeId: row.active_person_id || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Persons: upsert ----
app.put("/api/persons/:id", async (req, res) => {
  const { id } = req.params;
  const { name, profile, messages, summary, position } = req.body || {};
  try {
    await pool.query(
      `INSERT INTO persons (id, name, profile, messages, summary, position, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         profile = EXCLUDED.profile,
         messages = EXCLUDED.messages,
         summary = EXCLUDED.summary,
         position = EXCLUDED.position,
         updated_at = now()`,
      [
        id,
        name || "Person",
        JSON.stringify(profile || {}),
        JSON.stringify(messages || []),
        summary || "",
        Number.isFinite(position) ? position : 0,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Persons: delete ----
app.delete("/api/persons/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM persons WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Settings: upsert single row ----
app.put("/api/settings", async (req, res) => {
  const { ownProfile, style, emojis, model, activeId } = req.body || {};
  try {
    await pool.query(
      `UPDATE app_settings SET
         own_profile = $1, style = $2, emojis = $3, model = $4, active_person_id = $5
       WHERE id = 1`,
      [
        JSON.stringify(ownProfile || {}),
        style || "natural",
        !!emojis,
        model || "anthropic/claude-sonnet-4.5",
        activeId || null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- OpenRouter proxy ----
// Body is a standard OpenRouter chat-completions payload built by the client.
app.post("/api/ai/complete", async (req, res) => {
  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: "OPENROUTER_KEY not configured" });
  }
  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENROUTER_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://zzsocial.local",
        "X-Title": "ZZSocial",
      },
      body: JSON.stringify(req.body || {}),
    });
    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Upstream error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log("ZZSocial API listening on :" + PORT);
});
