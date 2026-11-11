# AppSec RPG

A browser RPG for practicing application security vocabulary. Fight through seven sections, answer multiple-choice and recall questions, review weak terms, and unlock endless mode after the campaign.

The glossary contains 173 source entries. Its 25 drill groups cover 44 distinct terms. Combat, timing, progress, and scoring are enforced by the server.

## Run locally

Requires Docker Compose. Copy `.env.example` to `.env`, supply distinct strong database and seed-account passwords, and set `DATABASE_URL` using the Compose database hostname `postgres`. For local HTTP, explicitly set `COOKIE_SECURE=false`; HTTPS deployments should keep the secure default.

```sh
docker compose up -d --build --wait
docker compose exec -T app npm run seed
```

Open `http://localhost:3000`. Sign in using a seeded account (`alice`, `bob`, or `admin`) and its configured password, or register a player account. Seeding again preserves existing progress and passwords.

For a deployment image, build from the reviewed source checkout with its full Git revision:

```sh
docker build --build-arg BUILD_REVISION="$(git rev-parse HEAD)" -t appsec-rpg .
```

Both health URLs report this revision as `buildRevision`. Local builds that omit the argument report `unknown`. Setting the argument name as a runtime environment variable does not change the reported revision.

## Verify

Use Node 22 and a disposable PostgreSQL 16 database with a name ending in `_test`. Set `NODE_ENV=test` and `DATABASE_URL` before running:

```sh
npm ci --ignore-scripts
npm test
```

The API tests create isolated schemas and remove them afterward. They cover authentication, authorization, CSRF, concurrent submissions, seed idempotence, all 49 campaign fights, endless unlocking, and defeat recovery.

## Project references

- [Runtime and authentication](docs/game/backend.md)
- [Browser controls](docs/game/frontend.md)
- [Glossary provenance](docs/game/content-provenance.md)
- [Verification record](docs/game/verification.md)
- [API contract](openapi.yaml)
- [Design specification](docs/superpowers/specs/2026-11-07-appsec-rpg-design.md)
- [Sprite prompts](docs/art/PROMPTS.md)
- [Security lab brief](docs/lab/LAB-SESSION-BRIEF.md)

The security lab pipeline is distinct from game completion. LAN staging, authenticated DAST, the deliberate authorization drill, and blocking policy rollout have their own deployment and evidence steps. Deliberate vulnerabilities belong only on unmerged demo branches.


## First-play upgrade

Before starting this version against an existing installation, run the additive migration with the installation's existing `DATABASE_URL`:

```powershell
node --env-file-if-exists=.env db/migrate-first-play.js
npm start
```

The migration adds nullable teaching feedback and battle advance state. Existing active question IDs and start times stay intact. It fills feedback only for unchanged bundled sector-zero terms whose explanation is empty, preserves custom content and progress, and can be rerun. It does not require seed passwords or a database reset. Fresh installs still use `npm run seed`.

Answer responses now have `question: null` while feedback is displayed. Clients must POST `/api/v1/battles/{id}/advance` with `{ "questionId": "<answered question ID>" }` before submitting another answer. Repeated advances return the same question without extending its deadline. The signed-in `GET /api/v1/battles/current` restores an active question or already-resolved feedback after refresh or a lost response. Recovery keeps original question deadlines. Coordinate the new `advanceBattle` and `currentBattle` OpenAPI operations and the private nightly scanner's pinned schema and coverage manifest before deployment. No deployment is included in this change.


The disposable first-play preview can be reproduced from PowerShell without using production settings:

```powershell
docker run --name appsec-first-play-db -e POSTGRES_PASSWORD=first-play-local-only -e POSTGRES_DB=first_play_test -p 127.0.0.1:55439:5432 -d postgres:16
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://postgres:first-play-local-only@127.0.0.1:55439/first_play_test'
$env:COOKIE_SECURE = 'false'
$env:SEED_ALICE_PASSWORD = 'alice-password-for-tests'
$env:SEED_BOB_PASSWORD = 'bob-password-for-tests'
$env:SEED_ADMIN_PASSWORD = 'admin-password-for-tests'
npm ci --ignore-scripts
npm run seed
npm test -- --silent
node -e "require('./server/app').createApp({pool:require('./server/db').createPool()}).listen(3217,'127.0.0.1')"
```

These are repository synthetic test fixtures for the disposable database only. Open `http://127.0.0.1:3217`. If the preview container already exists, use `docker start appsec-first-play-db` instead of creating it again. API tests use temporary schemas and preserve the preview schema. Stop the foreground server with Ctrl+C and stop its database with `docker stop appsec-first-play-db`.


For rendered boss, defeat/retry, endless-tier and leaderboard checks, run `tests/browser/first-play.cjs` manually against this disposable preview. It requires external Playwright tooling; setup and exact commands are recorded in `docs/superpowers/plans/first-play-report.md`. It resets only Bob/admin test fixtures and never modifies Alice. Screenshots are written outside the repository.
