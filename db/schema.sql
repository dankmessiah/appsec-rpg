CREATE TABLE IF NOT EXISTS users (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text NOT NULL UNIQUE,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    csrf_token text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS drill_groups (
    id text PRIMARY KEY,
    label text NOT NULL
);

CREATE TABLE IF NOT EXISTS terms (
    id text PRIMARY KEY,
    section integer NOT NULL CHECK (section BETWEEN 0 AND 6),
    term text NOT NULL,
    aliases text[] NOT NULL,
    definition text NOT NULL,
    scenario text,
    explanation text,
    drill_group_ids text[] NOT NULL,
    is_top25 boolean GENERATED ALWAYS AS (cardinality(drill_group_ids) > 0) STORED
);

CREATE TABLE IF NOT EXISTS progress (
    user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    player jsonb NOT NULL,
    campaign jsonb NOT NULL,
    endless jsonb NOT NULL,
    endless_best_streak integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS term_stats (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    term_id text NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    correct integer NOT NULL DEFAULT 0,
    wrong integer NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, term_id)
);

CREATE TABLE IF NOT EXISTS battles (
    id uuid PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('campaign', 'endless')),
    enemy jsonb NOT NULL,
    question jsonb NOT NULL,
    awaiting_advance boolean NOT NULL DEFAULT false,
    advanced_from uuid,
    last_feedback jsonb,
    no_damage boolean NOT NULL DEFAULT true,
    status text NOT NULL CHECK (status IN ('active', 'won', 'lost', 'forfeit')),
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS battles_one_active ON battles(user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS leaderboard (
    user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    best_kills integer NOT NULL,
    best_streak integer NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
