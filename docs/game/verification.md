# Game verification

Original verification was performed on 2026-11-08 in an isolated local checkout and Docker Compose project. The current first-play and recovery verification is recorded in [the November 10 report](../superpowers/plans/first-play-report.md), including exact commands and remaining limitations. The controller reviewed the implementation inline, as authorized, and returned two defects to the implementers: enemy names differed from the approved art table, and a victory without rank-up rendered the literal text `null`. Both were corrected and rechecked. Initial CI also identified an unthrottled database health endpoint and vulnerable packages bundled with the base image's npm installation; follow-up fixes add shared health throttling and update Alpine packages and npm.

## Automated checks

- The latest November 10 full run passes ten suites and 83 tests against isolated PostgreSQL 16, including transactional advance/recovery, migration preservation, practice isolation and admin-feedback invalidation. State-changing API suites create their own temporary schemas; the health-limit regression only performs database connectivity checks.
- Full campaign regression wins all 49 fights, checks every section unlock, persists 1295 XP, and permits endless only after the final boss. Defeat regression preserves earned XP and restarts the current section with full HP.
- Authentication, session rotation/expiry, secure cookie flags, CSRF, role checks, cross-user battle denial, stale questions, concurrent answers/starts, payload validation, and repeated seed behavior pass.
- The original November 8 container verification built Node 22 Alpine, ran as UID 1000, and found zero npm production audit findings. This is historical evidence; consult the current first-play report for the latest source verification.
- Five low-severity development-only audit findings remain through Jest's unpatched `deepmerge` dependency. They are not installed in the runtime image.
- The original November 8 container scan had zero high or critical findings. Two medium findings remain in npm's bundled `glob` and `minimatch`; these are separate from application dependency findings. No scanner suppressions were added.
- Both database health URLs share a 60-request-per-minute IP budget. Rejected requests do not query PostgreSQL. The container health probe normally uses 12 requests per minute.
- All 25 sprite PNGs have RGBA channels with transparent pixels. The set contains four player poses and three enemies for each section.

## Runtime and browser checks

- The original November 8 isolated Compose startup reached healthy status for the app and PostgreSQL. No database port is published. Both health endpoints return success.
- Seeding twice preserves account IDs, roles, password hashes, progress, and the 173 terms and 25 groups.
- On November 10, the reproducible Chrome runner `tests/browser/first-play.cjs` won all seven first-section encounters through real rendered controls and 12 correct answers: four grunt rewards of 15 XP, two elite rewards of 30 XP, and a boss reward of 65 XP. It asserted 185 total XP, Analyst rank-up, 110/110 HP, the first sector marked Cleared, sector two marked Current at fight one, and successful entry into that sector. No gameplay response was mocked. Screenshots and commands are in the first-play report.
- The November 10 disposable boss fixture verifies natural recall submission, incorrect-answer damage, combo reset, the three-second result lock, defeat preserving 120 XP, full-HP retry at fight one, and forfeit.
- The November 10 unlocked fixture starts at four endless kills, wins the fifth through rendered controls, verifies Tier 1 and a shorter next-question timer, then forfeits and checks retained XP, the five-kill summary, and the rendered leaderboard. Earlier November 8 evidence covered typed alias acceptance and public stats. Natural endless unlocking remains covered by the 49-fight API regression.
- Current Chrome layout checks use 390x844 and 1280x900: no page-wide horizontal overflow; long answers stay readable and naturally scroll on mobile. Original November 8 checks also observed 44-pixel battle controls at 360 pixels. Reduced motion is enabled in the reproducible first-play gameplay runner.

Current timer behavior: feedback has no next-question countdown. The owner/CSRF-protected advance endpoint starts the next question only after Continue, and retries preserve its question ID and start time. Reload and stale-request recovery resume the owner's active question or resolved feedback through `/battles/current`; safe starts never silently forfeit an existing fight. Lost terminal responses restore the saved-progress map without replaying their summary. See the first-play report for browser fault-injection evidence and the additive migration prerequisite.

## Assets

Sprites were generated with the built-in image tool from the approved subject prompts in [PROMPTS.md](../art/PROMPTS.md), augmented with the shared palette, orientation, transparent-background, margin, and cel-shading constraints. Player poses were derived from the idle design; the existing Hydra reference was adapted to transparency. Selected PNGs are stored in `public/assets/`. Optional UI icons and title art were not required or generated.

## Remaining lab evidence

This record does not claim LAN staging deployment, authenticated ZAP coverage, ephemeral runner replacement, or blocking-gate proof. Those remain separate infrastructure and lab tasks.
