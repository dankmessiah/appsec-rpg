# AppSec RPG implementation plan

> Implement with subagent-driven-development and task-level review. The user selected GPT-6.1 Sol implementers and review in the controller session. Each implementer has its own worktree; the controller integrates and reviews each result.

**Goal:** Build the game described by the existing design spec, satisfy issue #4's pipeline contract, and supply the staging target needed for the remaining lab exercises.

**Architecture:** Server-authoritative Express application backed by PostgreSQL 16. Pure question and combat modules feed transactional routes. A vanilla browser client renders returned state and never receives an unanswered question's answer. The game branch is separate from lab documentation and deliberate vulnerability branches.

**Stack:** Node 22, CommonJS server modules, Express, pg, bcrypt cost 12, Helmet, rate limiting, Zod, Jest and Supertest, Docker Compose, external HTML/CSS/JavaScript with generated PNG sprites.

## Accepted requirements and decisions

- Source: `docs/superpowers/specs/2026-11-07-appsec-rpg-design.md`, GitHub issue #4, and the user's local `AppSec Must-Know Areas & Glossary.pdf`.
- The user chose **25 drill groups**, not exactly 25 flagged individual terms. Combined groups include all component terms. Preserve `is_top25` as a derived membership flag for boss selection.
- The user chose generated sprites using `docs/art/PROMPTS.md` and the Hydra reference. The controller owns `public/assets/` and image generation; frontend code references the specified asset IDs.
- `COOKIE_SECURE` defaults true. Explicit false is permitted for LAN HTTP staging and local tests only. Document that setting; do not infer transport from untrusted forwarded headers.
- Use all seven glossary sections and the complete glossary term bank. Do not pad to an assumed count or fabricate missing definitions. Record actual extracted count and source mapping.
- The API requires `questionId` with an answer. The lab submits numeric `choice: 0`; multiple-choice options therefore use zero-based numeric choices.
- New implementation choices: integer damage rounds down after the combo multiplier; speed bonus is 5 in the first half of the timer, then decreases linearly to zero. Rank gains increase max HP without healing current HP; section clear/restart heals fully. Record these choices in tests.
- Preserve the original out-of-scope list. No email password reset, OAuth, multiplayer, sound, or additional frontend framework.

## Shared module contracts

All functions below use plain JSON-safe values. Tests can inject `rng` and `now`. No pure module performs database or network I/O.

### Domain worker owns these exports

`shared/questions.js`:

- `generateQuestion({ terms, section, boss, mode, stats = {}, difficulty = 0, now = Date.now(), rng = Math.random })` returns an internal question `{ id, variant, prompt, options?, timeLimitSeconds, startedAt, termId, answer, aliases, explanation }`. `startedAt` is epoch milliseconds. MC options are four strings and `answer` is their correct zero-based index; recall answer is the term string. Use all eligible section terms, only drill members for bosses, and weak-term weighting for bosses/endless.
- `publicQuestion(question)` returns only `{ id, variant, prompt, options?, timeLimitSeconds, startedAt }`. It must omit answer, aliases, termId, and explanation before submission.
- `checkAnswer(question, { choice, text }, now = Date.now())` returns `{ correct, timedOut, elapsedMs, correctAnswer, explanation }`. Enforce timer plus two-second grace, aliases, normalization, and one-character typo tolerance only for normalized expected strings longer than five characters. Reject invalid MC indices; routes validate input types.

`server/engine.js`:

- `createInitialProgress()` returns `{ player: { hp:100, maxHp:100, xp:0, rank:'Intern', combo:0 }, campaign: { section:0, fight:0, cleared:[false,false,false,false,false,false,false] }, endless: { kills:0, difficulty:0, unlocked:false } }`.
- `getRank(xp)` returns `{ name, index, maxHp, minXp, nextXp }`, with `nextXp:null` for the last rank.
- `createEnemy({ section, fight, mode, difficulty = 0, rng = Math.random })` returns `{ name, type, section, hp, maxHp, attack }`. Campaign fights 0-3 grunt, 4-5 elite, 6 boss. Endless selects a random section/type.
- `resolveTurn({ progress, enemy, correct, elapsedMs, timeLimitSeconds, noDamage = true, mode })` returns `{ progress, enemy, damageDealt, damageTaken, status, earnedXp, rankUp, noDamage }`. Status is active/won/lost. Apply the spec's timers, damage, combo, rank, healing, section progression, unlocks, and endless scaling without mutating inputs.
- `forfeitProgress(progress, mode)` returns the defeat/restart progress while preserving XP and term statistics (statistics remain route-owned).

Content files: `db/terms.json` is an array of `{ id, section, term, aliases, definition, scenario?, drill_group_ids }`. `db/drill-groups.json` is exactly 25 `{ id, label, term_ids }` groups. IDs must be stable lower-kebab-case. Every referenced term exists, every group is nonempty, and membership is reciprocal.

### Backend worker owns the HTTP contract

- `server/app.js` exports `createApp({ pool, now?, authRateLimit? })` for tests; `server/index.js` listens and handles shutdown; `server/db.js` provides the default pg pool.
- Registration/login return `{ user:{id,username,role}, csrfToken }` and set a session cookie. `/auth/me` returns the same safe shape. Never return email/password/session hashes.
- `/progress` returns the complete progress shape. `/battles` returns `{ id, enemy, question, progress }` using `publicQuestion`.
- Answer accepts `{ questionId, choice }` or `{ questionId, text }`; returns `{ correct, timedOut, correctAnswer, explanation, damageDealt, damageTaken, status, earnedXp, rankUp, progress, enemy, question }`, where `question` is the next public question or null. The frontend may show result feedback while the server timer continues; wrong-answer Continue lock lasts three seconds.
- Battle IDs and question IDs are UUIDs. Require session, CSRF, and explicit owner checks on answer/forfeit. Owner mismatch is 403, absent record 404, stale question or inactive battle 409. Lock progress and battle rows so concurrent answers cannot double-award XP and concurrent starts leave one active battle.
- Starting a battle forfeits an existing battle transactionally. Endless start requires unlocked progress. On death, persist restart state and update best endless kills/streak without exposing other users' private data.
- `/weak-spots` returns `{ terms:[{id,term,section,correct,wrong,definition}] }`; `/leaderboard` returns `{ entries:[{userId,username,rank,bestKills,bestStreak}] }`; `/users/:id/stats` returns only `{username,rank,bestKills,sectionsCleared}`.
- Admin term CRUD remains protected by admin role, validates group membership and complete term fields, and rejects invalid section/group IDs. Public clients have no term-bank endpoint.
- Implement all remaining spec routes, health at `/health` and `/api/v1/health`, generic errors, request IDs, parameterized SQL, security headers, request-size limits, rate limits, hashed session tokens, expiry/rotation/logout, and validation of every body/path.

## Task 1 Domain and glossary

Owner: domain implementer. Exclusive files: `shared/questions.js`, `server/engine.js`, `db/terms.json`, `db/drill-groups.json`, `tests/unit/questions.test.js`, `tests/unit/engine.test.js`, `tests/unit/content.test.js`, and a content provenance note under `docs/game/`.

- [ ] Write failing tests for question leakage, distractors, aliases/typos, deadlines, weak weighting, combat boundaries, rank/progression/unlock, endless scaling, and content integrity.
- [ ] Extract the full glossary from the existing local PDF. The controller already produced a text extraction at `C:/Users/xamar/AppData/Local/Temp/appsec-glossary.txt`; inspect source pages if wrapping is ambiguous.
- [ ] Implement the contracts above and the exact spec rules. Ensure each section has drill members so every boss is playable.
- [ ] Run focused Jest tests once the backend worker's package scaffold is integrated, or use an isolated temporary harness without committing a competing package manifest.
- [ ] Commit only owned files; hand back the commit and test evidence. The controller reviews before integration.

## Task 2 Backend and runtime

Owner: backend implementer. Exclusive files: `server/` except `engine.js`, `db/schema.sql`, `db/seed.js`, `package.json`, `package-lock.json`, Jest configuration, `.env.example`, `.dockerignore`, `Dockerfile`, `docker-compose.yml`, `openapi.yaml`, `tests/api/`, and backend/runtime instructions under `docs/game/`.

- [ ] Write failing API tests with an isolated schema in the supplied PostgreSQL test database. Refuse destructive test setup against an unspecified/non-test database.
- [ ] Add package/dependency scaffold and implement routes against the fixed domain contract. Do not create stub domain files that could overwrite the other worker's work.
- [ ] Seed schema, full content files, and Alice/Bob/admin with passwords read from environment. Seed code and its dependencies must be present in the omit-dev runtime image. Repeated seed must be safe for existing accounts/progress and must not reset passwords unless deliberately configured.
- [ ] Add non-root Node 22 runtime and Postgres 16 Compose service, healthchecks compatible with `up --wait`, no published database port, and all environment names expected by issue #4.
- [ ] Add root OpenAPI using relative server `/api/v1`, session and CSRF definitions, and actual response/request shapes.
- [ ] Prove login, cookie flags, CSRF denial, Alice/Bob ownership denial, admin denial and CRUD, expired sessions, logout, generic errors, safe stats, stale/concurrent answers, and health.
- [ ] Commit owned files and report tests, assumptions, and integration needs. The controller reviews before integration.

## Task 3 Browser client

Owner: frontend implementer. Exclusive files: `public/index.html`, `public/app.js`, `public/styles.css`, optional additional external browser modules, and frontend instructions under `docs/game/`. Do not create or overwrite assets.

- [ ] Implement all spec screens and the HTTP contract above: auth, map, battle, result, defeat/retry, weak spots, leaderboard, public stats, and endless summary.
- [ ] Keep state server-authoritative; send `questionId`, numeric choice or typed text, and CSRF header; handle expired sessions and failed/duplicate requests.
- [ ] Use the specified sprite IDs, clean cyan-on-navy style, responsive layout, 44px targets, keyboard shortcuts, reduced-motion support, visible focus, labels, and readable feedback. No inline scripts/styles, no unsafe HTML from server content.
- [ ] Keep a visible countdown during answer feedback so the server timer behavior is clear. Lock Continue for three seconds after a wrong answer.
- [ ] Verify static syntax and provide a manual interaction checklist. The controller performs integrated browser verification after backend integration.
- [ ] Commit only owned files. The controller reviews before integration.

## Controller tasks and review gates

- [ ] Create managed worktrees from the plan commit, one per implementer. Dispatch the three tasks with exact contracts and file ownership; do not let workers revert one another's work.
- [ ] Generate the four player poses and 21 enemy assets (reuse the Hydra design as a transparent sprite) with the built-in image tool, one asset per call. Persist the selected files under `public/assets/`, verify transparency and visual consistency, and avoid publishing unrelated local material.
- [ ] Review each task for spec compliance and security, integrate clean commits, run focused tests, and return concrete fixes to the same implementer when needed.
- [ ] Run full unit/API tests, dependency checks, clean Docker startup and runtime seed, authenticated browser playthrough of one full section, defeat/retry and endless using test state, and phone-width review. Verify no answer leakage or cross-user mutations.
- [ ] Update the spec's data-integrity wording from exactly 25 flagged terms to exactly 25 drill groups and document actual term count. Consolidate decisions and completion notes once, after integration.
- [ ] Publish a game PR; observe required security checks and fix actual findings. Keep all deliberate vulnerabilities on unmerged `demo/` branches.
- [ ] Deploy the reviewed app to LAN-only staging after concrete deployment approval. Complete authenticated ZAP, the Alice/Bob IDOR drill, blocking gate policy, and pipeline timing evidence in subsequent lab branches.

## Separate infrastructure workstream

Implementation checkpoint: all three game tasks are integrated and reviewed inline under the user's model exception. All 25 sprites are saved, the glossary spec is aligned, six suites and 25 tests pass, and local Compose plus browser section/defeat/endless/mobile checks pass. See `docs/game/verification.md` for evidence and limits. Game PR checks and the subsequent LAN deployment/lab work remain pending.

Ephemeral runner provisioning is user-requested but needs its own credential and lifecycle design. Do not put reusable GitHub administration credentials in disposable runners. Keep the existing runner available until a replacement can complete two consecutive jobs. GitHub App installation and restricted Proxmox API credentials require explicit setup authorization and credential handoff. The game implementation does not depend on changing the runner first.
