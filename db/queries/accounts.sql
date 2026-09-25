-- name: FirstFamily :one
SELECT * FROM families ORDER BY created_at LIMIT 1;

-- name: InsertFamily :one
INSERT INTO families (id, name) VALUES (@id, @name) RETURNING *;

-- name: InsertAccount :one
INSERT INTO accounts (id, username, password_hash, display_name)
VALUES (@id, @username, @password_hash, @display_name)
RETURNING *;

-- name: InsertFamilyMembership :exec
INSERT INTO family_memberships (family_id, account_id, role) VALUES (@family_id, @account_id, 'owner');

-- name: GetAccountByUsername :one
SELECT * FROM accounts WHERE username = @username;

-- name: SetAccountPassword :execrows
UPDATE accounts SET password_hash = @password_hash, updated_at = now() WHERE username = @username;

-- name: TouchAccountLogin :exec
UPDATE accounts SET last_login_at = now(), updated_at = now() WHERE id = @id;

-- name: GetMe :one
SELECT a.id AS account_id, a.username, a.display_name, f.id AS family_id, f.name AS family_name
FROM accounts a
JOIN family_memberships fm ON fm.account_id = a.id
JOIN families f ON f.id = fm.family_id
WHERE a.id = @account_id AND f.id = @family_id;

-- name: DeleteFamily :execrows
DELETE FROM families WHERE id = @id;

-- name: ListFamilyStorageKeys :many
SELECT original_key, storage_key FROM attachments WHERE family_id = @family_id;

-- name: InsertSession :exec
INSERT INTO sessions (id, account_id, expires_at, persistent, user_agent)
VALUES (@id, @account_id, @expires_at, @persistent, @user_agent);

-- name: GetSessionPrincipal :one
SELECT s.id, s.account_id, s.expires_at, s.last_seen_at, s.persistent, fm.family_id
FROM sessions s
JOIN family_memberships fm ON fm.account_id = s.account_id
WHERE s.id = @id AND s.expires_at > now()
ORDER BY fm.created_at
LIMIT 1;

-- name: TouchSession :exec
UPDATE sessions SET last_seen_at = now(), expires_at = @expires_at, updated_at = now() WHERE id = @id;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE id = @id;

-- name: DeleteAccountSessions :execrows
DELETE FROM sessions WHERE account_id = @account_id;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at <= now();
