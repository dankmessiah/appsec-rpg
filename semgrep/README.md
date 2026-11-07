# Custom Semgrep rules for appsec-rpg

Run by the `semgrep` job in `.github/workflows/security.yml` alongside the registry packs. Each rule has a fixture file of the same name with `// ruleid:` (must match) and `// ok:` (must not match) annotations.

| Rule | Catches | Confidence | Gate (Week 3) |
|---|---|---|---|
| `battle-route-missing-owner-check` | A `/battles/:id…` route handler that never references `user_id` (no ownership check): BOLA / IDOR, CWE-639 | Medium | Warn: heuristic, a check in a helper function is invisible to it |
| `db-query-string-concat` | `db.query()` / `pool.query()` with SQL built by `+`, `+=` or a template literal: SQLi, CWE-89 | High | Block on new findings |

Test locally:

```bash
pip install semgrep
semgrep --test --metrics=off semgrep/rules/
```

`semgrep/` is in `.semgrepignore` so the fixtures (which are deliberately vulnerable) don't show up as findings in the repo's own scan.
