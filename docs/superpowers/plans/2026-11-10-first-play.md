# First-play experience implementation plan

Goal: Ship the approved timer repair, compact combat, skippable untimed practice, and richer sector-zero feedback.
Architecture: Preserve Express/PostgreSQL and the vanilla browser client. Server owns question start/deadline and transactional battle identity. Practice is client-only and never awards XP or changes game state.
Spec: User approved the four-point design in this chat on November 10, 2026, including separate skippable practice.

## Global constraints
- No live deployment, production data changes, credentials, or infrastructure changes.
- Preserve ownership, CSRF, concurrent-request and stale-question protection.
- No em dashes in code or documents. Preserve all existing artwork and game balance.
- Existing player progress and users must survive content/schema updates; do not use reset/reseed as migration.

## Task 1: Integrated first-play experience
Read this task as the implementation requirements. Own server/battles.js, shared/questions.js, public/app.js, public/styles.css, necessary db and content files, API schema, tests and concise migration instructions.
- [ ] Establish baseline and write failing behavioral tests first.
- [ ] Stop creating/running next question deadlines during feedback. Add an owner/CSRF-protected transactional advance endpoint keyed to the previous question. First advance starts and returns the new question; duplicate/retried advance returns that same question without extending time or disclosing its answer. Reject stale/cross-owner requests. No answer submission can skip this state. Preserve first-fight timing and existing active battles.
- [ ] Update browser Continue to request advance; errors remain recoverable without losing prior feedback. Update API specification and affected tests/callers.
- [ ] Compact battle artwork/HP into a responsive header with question/answers prominent. Check 1280x900 and 390x844; long answers remain reachable, readable and keyboard accessible. Keep art, reduced motion and existing controls.
- [ ] Add first-fight introduction with skippable untimed practice, no API mutations/XP/damage. Explain timer, damage, combo, XP and section restart on defeat. Offer replay from campaign. Persist dismissal per signed-in user locally, tolerate unavailable storage. Existing advanced users should not be forced through it. Practice wrong answers teach and allow retry; completion or skip leads to explicit real-fight action.
- [ ] Enrich all sector-zero terms with why-it-fits and concrete examples; distinguish common confusions where useful. Avoid repeating definition as explanation. Keep question answers/aliases unchanged. Use additive idempotent content migration for existing installations that preserves player/user/history rows and unrelated/custom terms. Cover migration rerun/preservation with tests.
- [ ] Run unit/API tests against isolated test database only; test long feedback dwell, duplicate/concurrent advances, stale/foreign access, unanswered answer leakage, tutorial skip/replay/no reward, and existing full campaign progression.
- [ ] Prepare local browser preview with isolated disposable test data and report access method. Do not touch staging.
- [ ] Self-review and write docs/superpowers/plans/first-play-report.md with changes, exact test results, remaining limitations and local preview instructions.

## Review focus
Feedback dwell never consumes next-question time; repeated requests never reset deadlines; browser errors preserve recoverable state; tutorial cannot grant rewards; migration preserves existing progress; mobile long-answer readability.
