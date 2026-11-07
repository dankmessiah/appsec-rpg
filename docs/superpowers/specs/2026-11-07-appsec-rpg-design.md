# AppSec RPG — Design Spec

Date: 2026-11-07 (revision 2: client/server architecture)
Status: Approved design, pending user review of this document

## Purpose

A browser-based RPG that drills application security terminology before an interview. Enemies attack with questions drawn from the AppSec glossary and the Top 25 drill terms. Correct answers deal damage; wrong answers damage the player.

The app is deliberately built as a realistic web application (server, API, database, accounts, container) so it doubles as the test target for the AppSec pipeline lab described in `docs/lab/LAB-SESSION-BRIEF.md`. That is overkill for the game alone and is intentional.

Success criteria:
- Every glossary section and all Top 25 terms are reachable in the campaign.
- Weak terms surface more often, so repeated play targets gaps.
- Playable on phone and desktop from any browser; progress follows the account.
- Exposes the surfaces a SAST/DAST/SCA program needs: authenticated endpoints, per-user resources, an admin role, user input reaching the database, npm dependencies, a Dockerfile and compose file, an OpenAPI spec, a browser front end.

## Constraints

- Node.js 22, Express, PostgreSQL 16. Vanilla HTML/CSS/JS front end, no front-end framework or build step.
- Docker Compose deployment on the homelab (Proxmox), LAN-only behind Firewalla.
- No secrets in the repo. Configuration via `.env`; `.env.example` committed.
- Security controls are explicit in code (ownership checks, CSRF, rate limits, headers) so scanners can verify them and so deliberately seeded bugs on a branch are detectable.

## Architecture

```
appsec-rpg/
  server/
    index.js          Express bootstrap, middleware, route mounting
    db.js             pg Pool, parameterized query helper
    auth.js           register/login/logout, session cookie, CSRF, role guard
    routes/           auth.js, battles.js, progress.js, leaderboard.js, admin.js, health.js
    engine.js         game rules (pure functions, no I/O)
  shared/
    questions.js      question generation and answer checking (used by server and tests)
  public/
    index.html, app.js, styles.css
  db/
    schema.sql        tables and indexes
    seed.sql          term bank (~220 terms) and test users
    seed.js           runs seed.sql with passwords from .env
  tests/
    unit/             engine, questions, data integrity
    api/              Supertest integration tests
  openapi.yaml
  Dockerfile
  docker-compose.yml
  .env.example
  package.json
```

The server is authoritative. It generates each question, keeps the correct answer server-side, checks submissions, applies damage and XP, and persists state. The browser renders and sends answers only.

Internal modules follow the same discipline as a front-end state machine: `engine.js` and `shared/questions.js` are pure functions over plain objects; route handlers load state, call the engine, save, and respond.

## Data model (PostgreSQL)

| Table | Columns |
|---|---|
| users | id serial PK, username unique, email unique, password_hash, role ('player' / 'admin'), created_at |
| sessions | id uuid PK, user_id FK, token_hash, csrf_token, expires_at, created_at |
| terms | id text PK, section int, term, aliases text[], definition, scenario nullable, is_top25 bool |
| progress | user_id PK FK, player jsonb, campaign jsonb, endless jsonb, updated_at |
| term_stats | (user_id, term_id) PK, correct int, wrong int |
| battles | id uuid PK, user_id FK, mode, enemy jsonb, question jsonb (includes answer, never returned to client), status ('active' / 'won' / 'lost' / 'forfeit'), started_at, ended_at |
| leaderboard | user_id PK FK, best_kills, best_streak, updated_at |

All queries use parameterized statements through `db.js`. Progress JSON shapes:

```js
player:   { hp, maxHp, xp, rank, combo }
campaign: { section, fight, cleared: [bool x7] }
endless:  { kills, difficulty, unlocked: bool }
```

## API (`/api/v1`, documented in `openapi.yaml`)

| Method and path | Auth | Purpose |
|---|---|---|
| POST /auth/register | none | Create account. Username 3–20 chars, email, password ≥ 12 chars |
| POST /auth/login | none | Set session cookie; returns CSRF token |
| POST /auth/logout | session | Delete session |
| GET /auth/me | session | Current user and role |
| GET /progress | session | Player, campaign, endless state |
| GET /weak-spots | session | 15 worst terms with definitions |
| POST /battles | session | Start a fight: `{ mode: 'campaign' \| 'endless' }` → enemy and first question (no answer field) |
| POST /battles/:id/answer | session, owner | Submit `{ choice }` or `{ text }` → result, next question or kill summary |
| POST /battles/:id/forfeit | session, owner | Abandon the fight (counts as defeat) |
| GET /leaderboard | none | Top 20 endless scores |
| GET /users/:id/stats | none | Public stats: username, rank, best kills, sections cleared. Never progress or email |
| GET /admin/terms, POST /admin/terms, PUT /admin/terms/:id, DELETE /admin/terms/:id | admin | Term bank management |
| GET /health | none | `{ status: 'ok', db: true }` |

Cross-cutting:
- Helmet for security headers; CSP `default-src 'self'`, no inline scripts.
- Rate limiting: 10 requests per 15 minutes per IP on register and login; 120 per minute per user elsewhere.
- Input validation with a schema library (e.g. zod) on every body and param.
- Ownership checks on battle routes compare `battles.user_id` to the session user; admin routes check `role === 'admin'`.
- Errors return generic messages; stack traces never leave the server. Unhandled errors are logged with a request id.

## Auth and sessions

- bcrypt, cost 12.
- Session token: 32 random bytes, stored as SHA-256 hash in `sessions`, sent as cookie `sid` with `HttpOnly; Secure; SameSite=Strict; Path=/`. 7-day expiry; rotated on login; deleted on logout. Expired sessions rejected and purged.
- CSRF: per-session token returned at login and on `GET /auth/me`; required in `X-CSRF-Token` on every POST/PUT/DELETE except register and login.
- Roles: `player` default. `admin` assigned only by the seed script or direct DB update.
- Seed users: `alice` (player), `bob` (player), `admin` (admin). Passwords come from `SEED_ALICE_PASSWORD`, `SEED_BOB_PASSWORD`, `SEED_ADMIN_PASSWORD` in `.env`. Two players exist so the lab can replay Alice's requests as Bob.

## Content and question bank

Term rows (~220, seven sections in glossary order):
0 Testing types and tooling · 1 Vulnerability classes · 2 Web, auth and identity · 3 Standards and frameworks · 4 Risk scoring and prioritization · 5 Supply chain and CI/CD · 6 Program and process.

`is_top25` marks the 25 drill terms; where a drill term combines two glossary terms (e.g. "CVSS vs EPSS vs KEV"), each component term is flagged.

Question variants, generated by `shared/questions.js`:

| Variant | Prompt | Input | Used by |
|---|---|---|---|
| definition | "Which term means: {definition}?" | 4 terms (MC) | all |
| reverse | "What is {term}?" | 4 definitions (MC) | all |
| scenario | "{scenario} Which term applies?" | 4 terms (MC) | terms with a scenario |
| recall | "Name the term: {definition}" | typed text | bosses and endless |

- Distractors from the same section when ≥ 3 other terms exist there, else from the full bank.
- Typed answers normalized (lowercase, strip punctuation and whitespace), matched against term and aliases; Levenshtein ≤ 1 accepted for strings longer than 5 characters.
- The server stores the answer in `battles.question` and strips it from responses.
- Explanation after any answer: the term's definition, plus the correct option for MC.

## Combat rules

- Timer: 20 s MC, 30 s typed. The server records `question.startedAt`; a submission after the deadline (plus 2 s network grace) counts as wrong. The client shows the countdown.
- Correct: damage = (10 + speed bonus 0–5, full if answered within the first half) × combo multiplier. Combo 3 = 1.5×, 5+ = 2×.
- Wrong or timeout: player takes `enemy.attack`, combo resets, response includes correct answer and explanation; client locks Continue for 3 s.
- Enemies: grunt HP 20 / attack 10; elite HP 40 / attack 10; boss HP 80 / attack 20.
- Player HP 100 base, +10 per rank. No regen within a section; full heal on section clear or restart.
- Boss questions use only `is_top25` terms in the section, 50% recall variants, weak-term weighting.
- One active battle per user; starting a new one forfeits the old. Each question has an id; an answer with a stale question id is rejected, which prevents double submission.

## Progression

Campaign: 7 sections × (4 grunts, 2 elites, 1 boss). Boss clear unlocks the next section; clearing section 6 unlocks endless. Death restarts the section at fight 0 with full HP; XP and term stats are kept. Enemy names themed per section (flavor only).

XP and rank: grunt 10, elite 25, boss 60, +5 per fight with no damage taken. Ranks at cumulative XP: Intern 0 · Analyst 150 · AppSec Engineer 400 · Program Lead 800 · CISO Whisperer 1400. +10 max HP per rank.

Endless: random enemies from all sections. Difficulty tier rises every 5 kills: timers −2 s per tier (floor 8 s MC / 12 s typed), enemy attack +5 per tier. Run ends on death; best kills and best streak go to `leaderboard`.

Weak-term weighting: selection weight = 1 + 2 × max(0, wrong − correct) for boss fights and endless; uniform within section for campaign grunts and elites.

## Screens (front end)

| Screen | Content |
|---|---|
| Auth | Login and register forms. Shown when `GET /auth/me` returns 401 |
| Map | 7 section nodes (cleared / current / locked), rank and XP bar, Endless button (locked until campaign done), Leaderboard and Weak Spots links, Logout |
| Battle | Enemy name, type, HP bar; timer bar; question with 4 buttons or text input; player HP bar and combo meter |
| Result | Correct/wrong banner, damage, correct answer and explanation, Continue (3 s lock on wrong); XP and rank progress on kill |
| Defeat | Enemy name, XP kept, Retry section / Back to map |
| Weak Spots | Table of 15 worst terms with section, counts, definition |
| Leaderboard | Top 20 endless scores, each username linking to the public stats page |
| Endless | Battle screen with kill counter and tier; run summary on death |

Mobile-first: 44 px minimum tap targets, single column. Desktop: keys 1–4 and Enter. CSS-only feedback: screen shake on enemy hit, red flash on player hit, green flash on correct. Styling: clean modern terminal, cyan (#38E4FF) on deep navy (#070B16), magenta (#FF3FA4) for enemies and damage, amber (#FFC14D) for XP, no CRT effects. Sprites are PNG assets (cel-shaded vector style, see `docs/art/PROMPTS.md`): player idle/attack/hurt/victory and one grunt, elite and boss per section, served from `public/assets/`. All scripts external (CSP forbids inline).

## Deployment

- `Dockerfile`: multi-stage; runtime `node:22-alpine`, non-root user, `npm ci --omit=dev`, `HEALTHCHECK` on `/health`.
- `docker-compose.yml`: `app` (port 3000 on the LAN) and `postgres:16-alpine` (named volume, internal network only, not published). Healthchecks on both; `app` waits for `postgres` healthy. Env from `.env`.
- Target: an LXC or VM on the Proxmox host, reachable on the LAN only. Serves as the staging DAST target for the lab.
- Local dev: `docker compose up postgres` plus `npm run dev` (nodemon). `npm run seed` loads schema and seed data.
- `.env.example` lists `DATABASE_URL`, `SESSION_SECRET`, `SEED_*_PASSWORD`, `PORT`, `NODE_ENV`.

## Testing

- Jest. `npm test` runs unit and API suites; the pipeline runs it on every PR.
- Unit (`tests/unit/`): question generation and distractor rules, fuzzy matching (case, punctuation, aliases, one-character typo, rejection), damage/speed/combo math, wrong-answer handling, progression and unlocks, XP thresholds and HP bonus, endless scaling, weak-term weighting, data integrity (ids unique, every term complete, exactly 25 flagged).
- API (`tests/api/`, Supertest against a test database): register and login flow, cookie flags, logout invalidates session, expired session rejected, CSRF missing → 403, Bob cannot answer Alice's battle (403), player cannot reach admin routes (403), admin can CRUD terms, login rate limit (429), `/users/:id/stats` exposes no email or progress, answer with stale question id rejected, `/health` reports db.
- Manual before handoff: full section through its boss, defeat/retry, endless run, phone-width layout, `docker compose up` from a clean clone.

## Out of scope (v1)

Sound, achievements, password reset email, OAuth login, multiplayer, custom question authoring UI beyond admin CRUD.
