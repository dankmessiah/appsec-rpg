# Game verification

Verified on 2026-11-08 in an isolated local checkout and Docker Compose project. The controller reviewed the implementation inline, as authorized, and returned two defects to the implementers: enemy names differed from the approved art table, and a victory without rank-up rendered the literal text `null`. Both were corrected and rechecked.

## Automated checks

- Five suites and 24 tests pass against PostgreSQL 16. Each API suite creates its own temporary schema.
- Full campaign regression wins all 49 fights, checks every section unlock, persists 1295 XP, and permits endless only after the final boss. Defeat regression preserves earned XP and restarts the current section with full HP.
- Authentication, session rotation/expiry, secure cookie flags, CSRF, role checks, cross-user battle denial, stale questions, concurrent answers/starts, payload validation, and repeated seed behavior pass.
- Production container builds with Node 22 Alpine, runs as UID 1000, and has zero npm production audit findings at verification time.
- Five low-severity development-only audit findings remain through Jest's unpatched `deepmerge` dependency. They are not installed in the runtime image.
- All 25 sprite PNGs have RGBA channels with transparent pixels. The set contains four player poses and three enemies for each section.

## Runtime and browser checks

- Isolated Compose startup reaches healthy status for the app and PostgreSQL. No database port is published. Both health endpoints return success.
- Seeding twice preserves account IDs, roles, password hashes, progress, and the 173 terms and 25 groups.
- Browser sign-in, all seven encounters of the first section, correct-answer feedback, combo damage, boss reward, rank-up, section healing, and the next-section unlock pass against the real local API.
- A disposable low-HP fixture verifies incorrect-answer damage, the three-second result lock, defeat, full-HP retry, and forfeit.
- A disposable unlocked fixture verifies endless combat, typed alias acceptance, one kill, next-enemy transition, run summary, leaderboard, and public stats. Natural endless unlocking is separately covered by the full-campaign API regression.
- At a 360-pixel viewport, the map and battle have no horizontal overflow. Observed battle controls meet the 44-pixel minimum height.

The server starts the next question clock when returning answer feedback; the client displays that countdown while feedback is visible, as specified in the implementation plan. Reload returns to the map; starting another fight forfeits an existing active fight.

## Assets

Sprites were generated with the built-in image tool from the approved subject prompts in [PROMPTS.md](../art/PROMPTS.md), augmented with the shared palette, orientation, transparent-background, margin, and cel-shading constraints. Player poses were derived from the idle design; the existing Hydra reference was adapted to transparency. Selected PNGs are stored in `public/assets/`. Optional UI icons and title art were not required or generated.

## Remaining lab evidence

This record does not claim LAN staging deployment, authenticated ZAP coverage, ephemeral runner replacement, or blocking-gate proof. Those remain separate infrastructure and lab tasks.
