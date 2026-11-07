# AppSec RPG — Design Spec

Date: 2026-11-07
Status: Approved design, pending user review of this document

## Purpose

A single-player, browser-based RPG that drills application security terminology before an interview. Enemies attack with questions drawn from the AppSec glossary and the Top 25 drill terms. Correct answers deal damage; wrong answers damage the player. The goal is daily, repeatable practice that covers every glossary section before the interview and stays fun afterward.

Success criteria:
- Every glossary section and all Top 25 terms are reachable in the campaign.
- A full campaign playthrough takes under two hours total.
- Weak terms surface more often, so repeated play targets gaps.
- Playable on phone and desktop with no install.

## Constraints

- Single self-contained HTML file: `appsec-rpg.html`. No build step, no external dependencies.
- Vanilla HTML/CSS/JS. No frameworks.
- Progress saved in `localStorage`, with JSON export/import for moving between devices.
- No image assets; retro terminal/RPG look built with CSS.

## Architecture

One file, four internal modules, each a plain object or set of functions:

| Module | Responsibility | Depends on |
|---|---|---|
| `data` | The term bank: array of term objects, section list, rank table | nothing |
| `engine` | Pure functions: question generation, answer checking, damage/combo math, enemy and section progression, XP/rank, weak-term weighting | `data` |
| `storage` | `save(state)`, `load()`, `exportJSON()`, `importJSON(text)` wrapped in try/catch | nothing |
| `ui` | `render(state)` draws the current screen from state; event handlers call engine functions then `render` | `engine`, `storage` |

State is a single plain object. Every action follows `state = engine.someAction(state, input); storage.save(state); ui.render(state)`. The engine never touches the DOM, so it can be tested in isolation.

### State shape

```js
{
  screen: 'title' | 'map' | 'battle' | 'result' | 'defeat' | 'weak' | 'endless',
  mode: 'campaign' | 'endless',
  player: { hp, maxHp, xp, rank, combo },
  campaign: { section: 0..6, fight: 0..6, cleared: [bool x7] },
  endless: { kills, bestKills, bestStreak, difficulty },
  enemy: { name, type: 'grunt'|'elite'|'boss', hp, maxHp, attack, section } | null,
  question: { termId, variant, prompt, options?: [4 strings], answer, explanation, timerSec, startedAt } | null,
  lastResult: { correct, damageDealt, damageTaken, answer, explanation } | null,
  termStats: { [termId]: { correct, wrong } },
  settings: { sound: bool }
}
```

## Content and question bank

### Term object

```js
{ id: 'sast', section: 0, term: 'SAST', aliases: ['static application security testing', 'static analysis'],
  definition: 'Analyzes source code, bytecode or binaries without running them.',
  scenario: 'A tool flags a tainted parameter flowing into a SQL query at build time, before the app runs.',
  isTop25: true }
```

- ~220 terms across 7 sections in glossary order:
  0 Testing types and tooling · 1 Vulnerability classes · 2 Web, auth and identity · 3 Standards and frameworks · 4 Risk scoring and prioritization · 5 Supply chain and CI/CD · 6 Program and process.
- `scenario` is optional; not every term has a natural one.
- `isTop25` marks the 25 drill terms. Where a drill term combines two glossary terms (e.g. "CVSS vs EPSS vs KEV"), each component term is flagged.

### Question variants (generated at runtime)

| Variant | Prompt | Answer input | Used by |
|---|---|---|---|
| `definition` | "Which term means: {definition}?" | 4 terms (MC) | all enemies |
| `reverse` | "What is {term}?" | 4 definitions (MC) | all enemies |
| `scenario` | "{scenario} Which term applies?" | 4 terms (MC) | terms with a scenario |
| `recall` | "Name the term: {definition}" | typed text | bosses and endless only |

- Distractors come from the same section when at least 3 other terms exist there; otherwise from the full bank.
- Typed answers are normalized (lowercase, strip punctuation and whitespace) and matched against `term` and `aliases`. A Levenshtein distance ≤ 1 on strings longer than 5 characters also counts, to forgive single typos.
- Explanation shown after any answer = the term's definition (plus the correct option when MC).

## Combat rules

- Timer: 20 s for MC, 30 s for typed. Timeout counts as wrong.
- Correct: damage = 10 base + speed bonus (0–5, linear, full bonus if answered in the first half of the timer), times combo multiplier. Combo: 3 consecutive correct = 1.5×, 5+ = 2×.
- Wrong or timeout: player takes `enemy.attack` damage, combo resets to 0, result screen shows the correct answer and explanation and cannot be dismissed for 3 seconds.
- Enemy stats: grunt HP 20 / attack 10; elite HP 40 / attack 10; boss HP 80 / attack 20.
- Player HP 100 base, +10 per rank. No regen within a section; full heal when a section is cleared or restarted.
- Boss questions draw only from `isTop25` terms in the current section, mix in `recall` variants (50%), and weight weak terms.
- Double-answer guard: once an answer is submitted or the timer fires, further inputs are ignored until the next question renders.

## Progression

### Campaign
- 7 sections, each 7 fights: 4 grunts, 2 elites, 1 boss, in that order.
- Clearing the boss marks the section cleared and unlocks the next. Clearing section 6 unlocks endless mode.
- Player death: section restarts at fight 0 with full HP. XP and termStats are kept.
- Enemy names are themed per section (e.g. Testing types: "False Positive Swarm", "Flaky Crawler", boss "The Unscanned Monolith"). Names are flavor only.

### XP and rank
- XP: grunt 10, elite 25, boss 60. +5 bonus per fight finished with no damage taken.
- Ranks (cumulative XP): Intern 0 · Analyst 150 · AppSec Engineer 400 · Program Lead 800 · CISO Whisperer 1400.
- Each rank adds +10 max HP.

### Endless mode
- Unlocked after campaign completion. Random enemy types from all sections.
- Difficulty tier increases every 5 kills: tier n reduces timers by 2 s (floor 8 s MC / 12 s typed) and raises enemy attack by 5 per tier.
- Run ends on death. Tracks best kill count and best answer streak.

### Weak-term weighting
- `termStats` tracks correct/wrong per term.
- Selection weight = 1 + 2 × max(0, wrong − correct). Weak terms are up to several times more likely to be drawn in boss fights and endless mode. Grunt and elite fights in the campaign use uniform selection within the section so coverage stays even.
- "Weak Spots" screen lists the 15 terms with the highest wrong-minus-correct, with definitions.

## Screens

| Screen | Content |
|---|---|
| Title | Game name; Continue (if save exists), New Game, Endless (locked until campaign done), Weak Spots, Export/Import save |
| Map | 7 section nodes in a row: cleared / current / locked. Tap current to start the next fight. Shows rank and XP bar |
| Battle | Top: enemy name, type, HP bar. Middle: timer bar, question, 4 answer buttons or text input + submit. Bottom: player HP bar, combo meter |
| Result | Correct/wrong banner, damage dealt or taken, correct answer and explanation, Continue (locked 3 s on wrong). On kill: XP gained and rank progress |
| Defeat | "Defeated by {enemy}", XP kept, Retry section / Back to map |
| Weak Spots | Table: term, section, wrong/correct counts, definition |
| Endless | Same as Battle with a kill counter and difficulty tier shown; run summary on death |

- Mobile-first: minimum 44 px tap targets, single column, viewport meta.
- Desktop: keys 1–4 pick MC answers, Enter submits typed answers or continues.
- Feedback: screen shake on enemy hit, red flash on player hit, green flash on correct.

## Storage

- Single `localStorage` key `appsec-rpg-save-v1` holding the whole state minus transient fields (`question`, `lastResult`, `enemy` are rebuilt on load; a mid-battle reload restarts the current fight).
- All reads/writes in try/catch; on failure the game runs in memory and shows a one-line notice on the title screen.
- Export downloads `appsec-rpg-save.json`; Import accepts a pasted JSON string or file, validates the shape, and replaces the save.

## Testing

- `tests.html`: loads the same engine and data via inline `<script>` and runs assertions with a tiny custom `assert` that prints pass/fail to the page. Covers:
  - damage math (base, speed bonus, combo multipliers)
  - wrong answer resets combo and applies enemy attack
  - section/fight progression and unlock logic
  - XP thresholds and rank HP bonus
  - fuzzy matching (case, punctuation, aliases, one-character typo, rejection of wrong answers)
  - distractor selection never includes the correct answer twice
  - weak-term weighting prefers missed terms
  - data integrity: every term has id, section, term, definition; ids unique; 25 terms flagged Top 25
- Manual playtest before handoff: one full section through its boss, one defeat/retry, one endless run, export/import round trip, phone-width layout check.

## Out of scope (v1)

- Sound effects, multiplayer, leaderboards, server sync, achievements, custom question authoring UI.
