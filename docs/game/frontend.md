# Browser client verification

The browser uses the same-origin `/api/v1` API and keeps the CSRF token in memory. A reload restores the session through `/auth/me`, then checks `/battles/current`. An active fight resumes with its original question timestamp or already-resolved feedback; otherwise `/progress` loads the campaign map. Starting a fight uses `replaceActive: false`, so a retry cannot silently forfeit existing progress. Public operator records have shareable links in the form `/?player=<userId>`.

The server owns HP, XP, progress and question timing. Answer responses contain resolved feedback and `question: null`; reading feedback consumes no time from the next question. Continue sends the answered question ID to `/battles/{id}/advance`, which creates the next question and starts its clock. Duplicate advances return the same question and original start time. The server decides whether an answer arrived within the deadline and grace period. Stale requests restore the authoritative active fight or, when the fight is over, the saved-progress map. A lost terminal response restores progress without replaying its reward or defeat summary.

## Manual interaction checklist

- Open the app signed out. Switch between login and registration, submit invalid credentials, and verify a valid registration and login each reach the map. Reload to verify session restoration. Expire a session and request a protected screen to verify the return to login.
- Verify seven sectors, the current fight, rank, XP, and the locked Endless arena. Play all seven encounters in a test sector. Verify the clear unlocks the next sector and restores HP.
- Answer an MC prompt by clicking and with keys 1 to 4. Submit a recall answer with Enter. Rapidly press and click an answer to verify only one submission.
- Answer incorrectly and confirm the correct answer, explanation, damage taken, and three-second Continue lock. Leave feedback open beyond a full question duration, then verify Continue starts a fresh next-question clock. Retry a dropped Continue response and verify the same question ID/start time returns. Let a question expire and submit after the server's grace period to check timeout feedback.
- Reload during an unanswered question and during feedback. Drop committed start, answer and advance responses, then retry; verify the saved state returns without extra damage, XP or timer resets.
- Try first-fight practice, answer wrongly and retry, then skip or complete it. Verify no API mutation or rewards occur, the real fight starts only through its explicit action, dismissal is per user, and replay remains available from the map.
- Win a fight and verify XP and rank progress. Lose or forfeit a campaign fight and verify the defeat screen, retained XP, and retry at fight 1.
- Open Weak spots after a missed answer. Verify the term, sector, counts, and definition.
- Open the leaderboard while signed out. Follow an operator link and verify the public record exposes only rank, best kills, sections cleared, and username.
- With an unlocked test account, start Endless. Verify kills and tier across consecutive wins, then check the final kill and streak summary on defeat or forfeit.
- At phone width, verify 44px controls, a single-column answer list, no page overflow, and readable art and feedback. Tab through navigation and forms, and verify combat feedback with reduced motion enabled.

## Verification evidence

The original November 8 smoke evidence used a mock API: a headless Chromium smoke test at 360px used a mock same-origin API with strict CSP. It exercised login, the map, numeric keyboard answer, duplicate submission guard, literal rendering of markup in an explanation, timed wrong-answer feedback, recall submission, kill XP, and return to the map. That historical smoke test does not establish the current recovery or timer behavior. Current real-API Chrome evidence, reproducible browser commands, screenshots, migration requirements and exact automated results are recorded in [the first-play report](../superpowers/plans/first-play-report.md). The manual browser runner is `tests/browser/first-play.cjs`; it uses only Bob/admin fixtures in the guarded disposable database and leaves Alice untouched.


The November 10 complete-section browser gate also passed: Bob skipped the introduction explicitly, won fights one through seven through rendered controls, earned 185 XP, ranked up to Analyst, healed to 110/110 HP, saw sector two unlocked on the map, and started its first fight. The run answered 12 real questions and used no substituted gameplay responses. Screenshots are under `%TEMP%/appsec-first-play-qa/`, including `full-section-boss-clear-rank-up.png`, `full-section-sector-two-unlocked-map.png`, and `full-section-sector-two-first-question.png`.
