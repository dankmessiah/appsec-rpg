# Backend and runtime

Use Node 22 and PostgreSQL 16. Copy `.env.example` to `.env`, set a strong `POSTGRES_PASSWORD`, and set `DATABASE_URL` to the PostgreSQL connection URL. In Compose, use the hostname `postgres` and the configured database name and credentials. Percent-encode any reserved characters in the URL credentials. Supply distinct passwords for Alice, Bob, and the admin. Each seed password must have at least 12 characters and fit within bcrypt's 72-byte limit.

```sh
docker compose up -d --build --wait
docker compose exec -T app npm run seed
```

Health endpoints at `/health` and `/api/v1/health` verify the database connection. Run the seed command to create the schema, load the glossary, and provision the three accounts. Repeated seeding preserves existing accounts, progress, term edits, and passwords. Set `SEED_ROTATE_PASSWORDS=true` for one seed invocation to replace the seed account passwords and revoke their sessions. The container includes the seed command and its runtime dependencies.

Sessions use a random cookie token and a separate random CSRF token. Only the token's SHA-256 hash is stored. `SESSION_SECRET` is reserved for compatibility with the pipeline environment. Cookies use Secure by default. Serve staging over HTTPS to keep that default. For explicit LAN HTTP staging or local HTTP development, set `COOKIE_SECURE=false` and recreate the app container. The published app port defaults to 3000. PostgreSQL is reachable only on the internal Compose network.

For host development with a separate local PostgreSQL server, set `DATABASE_URL` to that server, run `npm ci --ignore-scripts` and `npm run seed`, then use `npm run dev` to start Node's watch mode. Set `NODE_ENV=test` and use a disposable PostgreSQL database whose name ends in `_test` when running `npm test`. The API suite creates and drops its own isolated schema in that database.

The [OpenAPI contract](../../openapi.yaml) describes the relative `/api/v1` endpoints. Mutations require `X-CSRF-Token` from login, registration, or `GET /auth/me`. A new battle forfeits the previous active battle for the same user. The server commits the answer, term statistics, battle and progress together, and rejects a repeated question ID. On an endless defeat or forfeit, `runSummary` reports the ended run's kills and best streak before the progress reset.
