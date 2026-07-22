# ZZSocial — Project Spec

## Storage (updated)
Data now lives in **PostgreSQL on an EC2 instance**, reached through a Node.js +
Express API on that box (`server/`). The browser app is **server-only** — it reads
and writes the API; no data is kept in localStorage (only the Server URL + App token
config are). The API is protected by a secret `X-App-Token` and CORS. OpenRouter is
**proxied** through the API, so the OpenRouter key lives only in the server's `.env`,
never in the browser. See `server/README.md` for deploy steps.

## Overview
A mobile-first browser app (plain JavaScript) that helps you carry on
a chat with a romantic or friendship interest. You paste in what the other person
said (or ask for an opener), and the AI **ghostwrites your next message** for you to
copy/paste into whatever real chat app you use (WhatsApp, iMessage, Instagram, etc.).

The AI does **not** write as the other person. It **models** the other person —
their profile, mood, and the full conversation history — in order to craft *your*
best next message.

- **User:** just me, for now.
- **AI backend:** OpenRouter (API call made from the browser).
- **Storage:** localStorage only (all phases).
- **Platform:** mobile-centric responsive browser app, vanilla JavaScript.

> **Security note:** Because the app calls OpenRouter directly from the browser, the
> API key ships in the client and is visible to anyone who inspects the page. This is
> acceptable for a personal, local-only tool that only I run. Do **not** deploy this
> publicly with a real key without adding a server-side proxy first.

## Core Concept
- **Own Use:** I'm chatting with someone I have a romantic/friendship intention
  toward. I either start the chat or they do. The AI generates *my* response. I
  copy/paste it into the real chat app.
- The AI holds context and **remembers all details** across the conversation.
- **Explicit / NSFW content:** only produced when I specifically ask for it.

## Phases

### Phase 1 — MVP
- Create this project-specific `.md` spec file. *(done)*
- New project: browser app, mobile-centric, JavaScript.
- Build the chat interface:
  - Type or paste what the other person said.
  - The AI drafts my reply (copy-out).
- **Button: "Start chat"** — generates the first message (my opener).
- Persist chat to **localStorage**.

### Phase 2 — Settings / Personas
Two profiles per conversation:
- **Own Settings** — entered explicitly by me.
- **Friend Settings** — entered manually by me (not auto-derived).

Fields (both profiles):
- Age
- Sex
- Ethnicity
- Country
- **Personality** — MBTI (16 types) picker + free-text notes box.
- Mood
- **Goal** — relationship context: what this person is to me / what I'm after, so
  the AI knows the framing. *(Not a multi-stage steering funnel.)*

These profiles feed the AI prompt so replies match both people.

### Phase 3 — Persons Database *(done)*
- Multiple **named** people, each with their own **Them profile** and their own
  **conversation**, stored locally (`zz.persons`, `zz.activePerson`).
- Header shows the active person; tapping it opens the **People** manager to
  switch / add / rename / delete.
- Legacy single-conversation data is migrated into a first person on first load.
- The **You** profile, typing style, and emoji setting remain **shared** across
  people (not yet per-person — possible future enhancement).

### Phase 4 — Compact Chats *(done)*
- Each person carries a running `summary`. Once a chat reaches `COMPACT_WHEN` (24)
  messages, all but the last `KEEP_RECENT` (12) are folded into that summary via an
  AI call, then dropped from the message list.
- The summary is sent to the AI on every draft and every background evaluation, so
  long conversations still "remember" earlier details while sending far fewer tokens.
- A dashed banner at the top of the chat shows "Earlier messages summarized — tap to
  view"; Settings has a manual "Compact chat now" button. Clearing a chat also clears
  its summary.

### Phase 5 — Scenario Coaching
- I explain a scenario in plain language.
- The AI provides a recommended course of action (advice mode, not a drafted message).

## Open / Deferred Decisions
- OpenRouter model choice (default model to use for drafting).
- Exact prompt structure for combining Own + Friend profiles + history.
- Where the OpenRouter API key is stored/entered (e.g. a settings field in the app).
- Compaction strategy details (Phase 4).

## Out of Scope (for now)
- Direct integration with real chat apps (WhatsApp, etc.) — copy/paste only.
- Multi-user / accounts / cloud sync.
- Public deployment with an embedded key.
