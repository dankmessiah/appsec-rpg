# Game completion audit

Audited the original game design, issue #4 and the approved first-play design against current implementation. This is local acceptance evidence; the reviewed branch has not been published or deployed.

| Requirement | Evidence |
| --- | --- |
| Seven sections, 173 terms, 25 drill groups and 44 members | Content integrity tests and original source mapping in docs/game/content-provenance.md |
| Combat math, rank/HP, all 49 campaign fights and endless unlock | Unit and API progression tests |
| Real rendered full section through boss | tests/browser/first-play.cjs: seven wins, 12 correct answers, 185 XP, Analyst, 110/110 HP, next sector unlocked and entered |
| Boss recall, wrong-answer damage, defeat/retry | Same browser harness: correct recall, deliberate misses, retained XP, fight-one restart and full heal |
| Endless scaling and run recording | API and browser: fifth kill raises tier, next timer 18 seconds, forfeit summary and leaderboard best five |
| Onboarding and compact layout | Practice wrong/correct/skip/replay tests; zero reward mutations; desktop and phone browser checks |
| Timer and request recovery | API/client tests plus independent browser response-drop/reload tests preserve battle/question/start time, damage and XP |
| Weak spots | tests/api/weak-spots.test.js: actual missed answer counts and definition, unauthenticated rejection, cross-player isolation, fifteen most unresolved terms |
| Public profile UI | Signed-out fresh browser context followed admin leaderboard link; only rank, best kills, username and cleared sectors rendered |
| Auth, sessions, CSRF, ownership, admin CRUD and validation | API tests, including stale teaching-feedback invalidation on content edits |
| Migration | Existing schema upgraded and rerun; user/progress/history/custom-content preservation tested |
| Clean-source container install | git archive of 69aa38f, isolated Compose build/up --wait, runtime seed, both healthy, non-root node runtime, unpublished PostgreSQL |
| Clean-install gameplay | New player registered through browser on clean Compose app; first fight won in two correct answers, 15 XP, next fight available |
| Documentation | Updated frontend and verification records; current API operations and additive migration documented |

Clean-install proof used a disposable local Compose project and only repository synthetic test credentials. App was bound to loopback. No staging or live infrastructure was changed. Source had no node_modules, .env or runtime data before setup. Docker reused valid cached dependency layers. Build revision is unknown because this local Compose build intentionally omitted the optional deployment build argument.

Independent response-drop tests exercised committed start, answer and advance requests. Retrying kept authoritative battle state and deadlines. Reloading an unanswered question kept its start time; reloading feedback retained resolved state. Lost terminal responses restore saved progress without replaying the final summary. This documented limitation does not duplicate rewards or block further play.

The tested staging release is still the earlier version. Publishing, merging, scanner-contract coordination and staging rollout require the outstanding integration decision. This audit does not claim hosted checks or new live deployment.

Final integrated acceptance run: 11 suites and 85 tests passed. The clean-install Compose project and synthetic database volume were removed after verification; the normal loopback preview remains available. Astra reviewed the follow-up and found no unproven original acceptance gate or blocking defect.
