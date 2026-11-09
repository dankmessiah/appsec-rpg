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
