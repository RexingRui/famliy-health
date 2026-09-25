-- +goose Up
-- false = "30 天内保持登录" unchecked: short server TTL and a browser-session cookie.
ALTER TABLE sessions ADD COLUMN persistent boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE sessions DROP COLUMN persistent;
