# First-play implementation report

Implementation and recovery follow-up complete for independent review, November 10, 2026.

Implemented explicit transactional question advance, compact combat, client-only skippable and replayable practice, all 32 sector-zero teaching explanations, additive migration, API documentation and behavioral tests. Practice dismissal is keyed by signed-in user and tolerates blocked storage. Existing advanced players bypass the automatic introduction. Completed-campaign replay offers a map return instead of an invalid campaign start.

Baseline: 9 suites, 64 tests passed. Timer/migration/content regressions failed for expected missing behavior before implementation. First integrated run: 10 suites, 70 tests passed. A subsequent completed-campaign replay regression failed first, then passed with the correction. Recovery and endless follow-up run: 10 suites, 77 tests passed in 8.767 seconds. After the final admin-feedback correction, **10 suites, 83 tests passed**, 8.682 seconds. Exact command from the worktree: `$env:NODE_ENV="test"; $env:DATABASE_URL="postgresql://postgres:first-play-local-only@127.0.0.1:55439/first_play_test"; npm test -- --silent`. All API tests use random isolated schemas and remove those schemas afterward; preview fixtures remain in the public schema.

Headless Chrome checked long-answer fixtures at 1280x900 and 390x844. No horizontal overflow, all answer text readable, keyboard Tab moves between answers, and no browser JavaScript errors. Mobile uses natural vertical scrolling; the fourth long answer extends below the initial viewport. Practice made zero POST requests. Screenshots: `%TEMP%/appsec-first-play-1280.png` and `%TEMP%/appsec-first-play-390.png`.

Local preview: http://127.0.0.1:3217, loopback only. Disposable Docker container `appsec-first-play-db`, PostgreSQL 16 on 127.0.0.1:55439, database `first_play_test`. Preview uses repository synthetic test account fixtures. No staging, production, credentials or live infrastructure were accessed. Browser-only checks for long answer layouts substitute the displayed question text; the normal preview serves real content.

The refresh lockout was reproduced in Chrome before the recovery follow-up. It is now fixed with owner-session `GET /battles/current`, which atomically reads progress and active battle in the same lock order as mutations. A transactionally saved `last_feedback` is returned only while awaiting Continue. An unanswered question exposes only public fields and its original start time. Refresh restores the active fight automatically; lost start/answer responses and cross-tab stale Continue recover through the same read after a 409. Safe start always uses `replaceActive: false`. New API/client tests cover those paths. An independent read-only Astra review found no blocking recovery code issues.

Terminal lost-response limitation: if the lost answer response ended the fight, recovery returns the saved-progress map because there is no active battle. The reward or defeat summary is not replayed. No duplicate XP, damage, run record or battle reward occurs; repeated terminal answer and forfeit requests return 409. Browser recovery was independently verified by the parent; expanded rendered boss/defeat/endless checks also passed as recorded below.

Upgrade prerequisite: run `node --env-file-if-exists=.env db/migrate-first-play.js` before starting new code. Never reset/reseed an existing database. Migration adds `terms.explanation`, `battles.awaiting_advance`, and `battles.advanced_from`, and `battles.last_feedback`. Existing questions and start times remain intact. Feedback fills only NULL values for bundled IDs with matching section, term, definition, aliases and scenario. Custom terms, customized built-in text, existing custom feedback, users, progress and history are preserved. Schema downgrade is not included.

Contract changes: new `currentBattle` GET restores only the owner's active question or answered feedback and requires no CSRF header. Answer returns `question: null` during feedback; new `advanceBattle` POST requires the answered questionId. Duplicate retries return the same next question and deadline, and stale requests are rejected. The private nightly scanner pins the exact operation set, so its schema and coverage manifest must be coordinated before deployment. No deployment is authorized or performed.

No application dependencies added. Temporary Playwright tooling lives outside the repository. `npm ci --ignore-scripts` reported five low-severity advisories in existing locked dependencies; no lockfile changes were made.


## Parent playtest fixtures

Preview server is listening on loopback port 3217 with the migrated schema. Existing synthetic accounts: Bob is at sector zero fight six, ready for the first boss, XP120; admin has the campaign complete and endless unlocked at four kills, XP1000. Alice was left unchanged by that fixture setup. The fixture initializer is outside the repository at `%TEMP%/appsec-first-play-browser/fixtures.cjs`, checks the exact disposable URL, and updates only Bob/admin progress. With the test environment above, rerun it from the worktree using `node $env:TEMP/appsec-first-play-browser/fixtures.cjs`. Avoid resetting a fixture while its UI playtest is underway.

Coverage includes all 49 campaign fights, five actual endless kills with tier and question-time changes, concurrent forfeit single-record behavior, repeated terminal timeout/forfeit rejection, migration rerun and customized-content preservation, concurrent advances, long feedback dwell, stale and foreign access, and client practice/recovery isolation. Existing art and balance were retained. No production dependencies or lockfile changes. README contains tested install, seed, migration, test and loopback preview commands.


## Rendered browser QA completion

The reproducible browser runner is `tests/browser/first-play.cjs`. It uses headless Chrome at 390x844 with reduced motion, controls rendered inputs and buttons, observes their actual responses, and solves questions from bundled glossary content. Gameplay responses are never mocked or replaced. Its fixture writes are restricted to Bob/admin on the exact disposable localhost database; Alice is excluded. Boss recall is naturally generated; if a whole loss happens without recall, the runner retries Bob's guarded fixture. This browser script is run manually and is separate from Jest.

Passed November 10, 2026:

- Bob: first-sector boss rendered a recall question, SARIF was submitted correctly, correct feedback showed damage dealt, deliberate wrong answers showed damage taken and reset combo. Defeat rendered XP kept 120. Retry section started the first grunt with full HP and the same 120 XP.
- Admin: starting at four endless kills, a real UI victory rendered five kills and Tier 1. Next enemy rendered a shorter 18-second question. Forfeit rendered a five-kill summary and kept XP1030. The leaderboard displayed admin with best kills five and streak three.
- Screenshots were visually inspected for recall, defeat, next tier, summary and leaderboard. The runner asserted no page-wide horizontal overflow. No application bug was found in these scenarios. The harness's initial encoded middle-dot selector was corrected to a robust text regex before the passing run.
- Parent independently verified unanswered reload retains question ID/start time; dropping a committed answer response and retrying does not change player/enemy HP twice; refresh restores feedback; dropping a committed advance response and retrying retains the same next question/start; dropping a committed start response from Retry section and retrying restores the same battle with full HP and earned XP kept.
- Parent independently reran `npm test -- --silent`: 10 suites, 77 tests passed in 8.415 seconds. No full-suite run was performed concurrently with the parent's browser playtest.

Screenshots are outside the repository under `%TEMP%/appsec-first-play-qa/`: `boss-recall-question.png`, `boss-recall-correct-feedback.png`, `boss-wrong-feedback.png`, `boss-defeat.png`, `boss-retry-section-first-fight.png`, `endless-fifth-kill-tier-one.png`, `endless-tier-one-next-question.png`, `endless-forfeit-summary.png`, and `endless-leaderboard-admin-five-kills.png`.

To rerun from the worktree with the preview server running, use the disposable database environment from README and install browser tooling outside the repository:

```powershell
npm install --prefix "$env:TEMP/appsec-first-play-browser" playwright --no-audit --no-fund
$env:PLAYWRIGHT_MODULE_PATH = "$env:TEMP/appsec-first-play-browser/node_modules/playwright"
node tests/browser/first-play.cjs
```

The runner defaults to installed Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`; set `CHROME_EXECUTABLE` for another local Chrome executable. Set `FIRST_PLAY_ARTIFACT_DIR` to select a screenshot directory. It requires `NODE_ENV=test` and the exact guarded `first_play_test` URL on 127.0.0.1:55439. It resets only Bob/admin fixtures and leaves their final outcomes in the preview: Bob at fight one after forfeit; admin with the endless run reset and leaderboard best five. Synthetic fixture credentials remain the existing repository test values.


## Final review correction: customized teaching feedback

Astra found that the supported admin PUT could change a built-in definition while retaining its old teaching explanation. Five new regressions reproduced this for section, term, aliases, definition and scenario edits. `server/admin.js` now compares those submitted fields with the existing row in the same SQL UPDATE and clears explanation only when they differ. Newly generated questions then use the updated definition through the existing fallback. No-op and drill-group-only updates retain their feedback. The admin request schema is unchanged and still does not accept explanation text. Existing in-flight question snapshots remain consistent with the question already shown.

Final complete verification after the fix: `npm test -- --silent`, 10 suites and 83 tests passed in 8.682 seconds against the isolated test database. `node --check server/admin.js` and `git diff --check` passed. The loopback preview is restarted to load the correction. Astra re-review requested; its disposition is reported by the parent.
