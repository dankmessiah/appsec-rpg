# Browser client verification

The browser uses the same-origin `/api/v1` API and keeps the CSRF token in memory. A reload restores the session and campaign map through `/auth/me` and `/progress`. Starting a fight after reload uses the server's active-fight forfeit behavior. Public operator records have shareable links in the form `/?player=<userId>`.

Battle responses own HP, XP, progress, and the next question. The next question's countdown starts from the server timestamp and remains visible while feedback is open. The server decides whether an answer arrived within the deadline and grace period. A stale question or missing battle returns the client to the map with refreshed progress.

## Manual interaction checklist

- Open the app signed out. Switch between login and registration, submit invalid credentials, and verify a valid registration and login each reach the map. Reload to verify session restoration. Expire a session and request a protected screen to verify the return to login.
- Verify seven sectors, the current fight, rank, XP, and the locked Endless arena. Play all seven encounters in a test sector. Verify the clear unlocks the next sector and restores HP.
- Answer an MC prompt by clicking and with keys 1 to 4. Submit a recall answer with Enter. Rapidly press and click an answer to verify only one submission.
- Answer incorrectly and confirm the correct answer, explanation, damage taken, and three-second Continue lock. Verify the next countdown keeps running. Let a question expire and submit after the server's grace period to check timeout feedback.
- Win a fight and verify XP and rank progress. Lose or forfeit a campaign fight and verify the defeat screen, retained XP, and retry at fight 1.
- Open Weak spots after a missed answer. Verify the term, sector, counts, and definition.
- Open the leaderboard while signed out. Follow an operator link and verify the public record exposes only rank, best kills, sections cleared, and username.
- With an unlocked test account, start Endless. Verify kills and tier across consecutive wins, then check the final kill and streak summary on defeat or forfeit.
- At phone width, verify 44px controls, a single-column answer list, no page overflow, and readable art and feedback. Tab through navigation and forms, and verify combat feedback with reduced motion enabled.

## Verification evidence

`node --check public/app.js` and `git diff --check` pass. A headless Chromium smoke test at 360px used a mock same-origin API with strict CSP. It exercised login, the map, numeric keyboard answer, duplicate submission guard, literal rendering of markup in an explanation, timed wrong-answer feedback, recall submission, kill XP, and return to the map. Integrated backend and generated sprite verification use the checklist above.
