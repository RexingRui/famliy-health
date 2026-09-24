-- +goose Up
CREATE TYPE member_relation AS ENUM ('self', 'spouse', 'child', 'parent', 'grandparent', 'other');
CREATE TYPE member_gender AS ENUM ('male', 'female');
CREATE TYPE blood_type AS ENUM ('A', 'B', 'AB', 'O', 'unknown');
CREATE TYPE episode_kind AS ENUM ('short', 'long');
CREATE TYPE episode_status AS ENUM ('active', 'recovered', 'treating', 'stable', 'ended');
CREATE TYPE record_type AS ENUM ('symptom', 'temperature', 'medication', 'visit', 'treatment', 'exam', 'other');
CREATE TYPE attachment_kind AS ENUM ('photo', 'audio', 'avatar');
CREATE TYPE attachment_status AS ENUM ('pending', 'processing', 'ready', 'failed');
CREATE TYPE job_status AS ENUM ('pending', 'running', 'done', 'failed');

CREATE TABLE families (
    id         uuid PRIMARY KEY,
    name       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
    id            uuid PRIMARY KEY,
    username      text        NOT NULL UNIQUE,
    password_hash text        NOT NULL,
    display_name  text        NOT NULL DEFAULT '',
    last_login_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE family_memberships (
    family_id  uuid        NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    role       text        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (family_id, account_id)
);

-- id is the SHA-256 of the session token; the raw token only lives in the cookie.
CREATE TABLE sessions (
    id           bytea PRIMARY KEY,
    account_id   uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    expires_at   timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    user_agent   text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE members (
    id          uuid PRIMARY KEY,
    family_id   uuid            NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    nickname    text            NOT NULL,
    relation    member_relation NOT NULL,
    gender      member_gender   NOT NULL,
    birth_date  date            NOT NULL,
    avatar_id   uuid,
    allergies   text,
    notes       text,
    blood_type  blood_type,
    sort_order  int             NOT NULL DEFAULT 0,
    archived_at timestamptz,
    created_at  timestamptz     NOT NULL DEFAULT now(),
    updated_at  timestamptz     NOT NULL DEFAULT now()
);
CREATE INDEX members_family_idx ON members (family_id, sort_order);

-- family_id NULL = preset tag shared by all families.
CREATE TABLE disease_tags (
    id         uuid PRIMARY KEY,
    family_id  uuid REFERENCES families (id) ON DELETE CASCADE,
    name       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (family_id, name)
);

CREATE TABLE episodes (
    id             uuid PRIMARY KEY,
    family_id      uuid           NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    member_id      uuid           NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    disease_tag_id uuid           NOT NULL REFERENCES disease_tags (id) ON DELETE RESTRICT,
    name           text           NOT NULL,
    kind           episode_kind   NOT NULL,
    status         episode_status NOT NULL,
    started_on     date           NOT NULL,
    ended_on       date,
    created_at     timestamptz    NOT NULL DEFAULT now(),
    updated_at     timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT episodes_status_matches_kind CHECK (
        (kind = 'short' AND status IN ('active', 'recovered'))
        OR (kind = 'long' AND status IN ('treating', 'stable', 'ended'))
    )
);
CREATE INDEX episodes_member_status_idx ON episodes (member_id, status);

CREATE TABLE records (
    id          uuid PRIMARY KEY,
    family_id   uuid        NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    member_id   uuid        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    episode_id  uuid REFERENCES episodes (id) ON DELETE SET NULL,
    type        record_type,
    occurred_at timestamptz NOT NULL,
    body        text        NOT NULL DEFAULT '',
    is_flare    boolean     NOT NULL DEFAULT false,
    severity    smallint CHECK (severity BETWEEN 0 AND 10),
    temperature numeric(3, 1),
    med_name    text,
    med_dose    numeric,
    med_unit    text CHECK (med_unit IN ('ml', '片', '粒', '袋')),
    cost_cents  int CHECK (cost_cents >= 0),
    details     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    search_text text        NOT NULL DEFAULT '',
    created_by  uuid REFERENCES accounts (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX records_member_time_idx ON records (member_id, occurred_at DESC);
CREATE INDEX records_episode_time_idx ON records (episode_id, occurred_at DESC);
CREATE INDEX records_inbox_idx ON records (family_id, occurred_at DESC) WHERE episode_id IS NULL;
CREATE INDEX records_medication_idx ON records (member_id, med_name, occurred_at DESC) WHERE type = 'medication';

CREATE TABLE attachments (
    id           uuid PRIMARY KEY,
    family_id    uuid              NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    record_id    uuid REFERENCES records (id) ON DELETE CASCADE,
    kind         attachment_kind   NOT NULL,
    status       attachment_status NOT NULL DEFAULT 'pending',
    original_key text              NOT NULL,
    storage_key  text,
    mime         text              NOT NULL,
    size_bytes   bigint            NOT NULL,
    duration_ms  int CHECK (duration_ms BETWEEN 0 AND 180000),
    width        int,
    height       int,
    caption      text,
    sort_order   int               NOT NULL DEFAULT 0,
    created_at   timestamptz       NOT NULL DEFAULT now(),
    updated_at   timestamptz       NOT NULL DEFAULT now()
);
CREATE INDEX attachments_record_idx ON attachments (record_id, sort_order);

ALTER TABLE members
    ADD CONSTRAINT members_avatar_fk FOREIGN KEY (avatar_id) REFERENCES attachments (id) ON DELETE SET NULL;

CREATE TABLE jobs (
    id         uuid PRIMARY KEY,
    kind       text        NOT NULL,
    payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    status     job_status  NOT NULL DEFAULT 'pending',
    attempts   int         NOT NULL DEFAULT 0,
    run_after  timestamptz NOT NULL DEFAULT now(),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pending_idx ON jobs (run_after) WHERE status = 'pending';

-- +goose Down
DROP TABLE jobs;
ALTER TABLE members DROP CONSTRAINT members_avatar_fk;
DROP TABLE attachments;
DROP TABLE records;
DROP TABLE episodes;
DROP TABLE disease_tags;
DROP TABLE members;
DROP TABLE sessions;
DROP TABLE family_memberships;
DROP TABLE accounts;
DROP TABLE families;
DROP TYPE job_status;
DROP TYPE attachment_status;
DROP TYPE attachment_kind;
DROP TYPE record_type;
DROP TYPE episode_status;
DROP TYPE episode_kind;
DROP TYPE blood_type;
DROP TYPE member_gender;
DROP TYPE member_relation;
