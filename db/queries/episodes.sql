-- name: ListDiseaseTags :many
SELECT * FROM disease_tags
WHERE family_id = @family_id
ORDER BY created_at, name;

-- name: GetDiseaseTag :one
SELECT * FROM disease_tags WHERE id = @id AND family_id = @family_id;

-- name: FindDiseaseTagByName :one
SELECT * FROM disease_tags WHERE name = @name AND family_id = @family_id;

-- name: InsertDiseaseTag :one
INSERT INTO disease_tags (id, family_id, name) VALUES (@id, @family_id, @name) RETURNING *;

-- name: ListEpisodes :many
SELECT sqlc.embed(e), t.name AS disease_name,
       COALESCE(s.record_count, 0)::int AS record_count,
       COALESCE(s.last_record_at, 'epoch'::timestamptz)::timestamptz AS last_record_at,
       COALESCE(s.cost_total, 0)::bigint AS cost_total_cents
FROM episodes e
JOIN disease_tags t ON t.id = e.disease_tag_id
LEFT JOIN LATERAL (
    SELECT count(*) AS record_count, max(r.occurred_at) AS last_record_at, sum(r.cost_cents) AS cost_total
    FROM records r WHERE r.episode_id = e.id
) s ON true
WHERE e.family_id = @family_id
  AND (sqlc.narg(member_id)::uuid IS NULL OR e.member_id = sqlc.narg(member_id)::uuid)
  AND (sqlc.narg(disease_tag_id)::uuid IS NULL OR e.disease_tag_id = sqlc.narg(disease_tag_id)::uuid)
  AND (sqlc.narg(kind)::text IS NULL OR e.kind::text = sqlc.narg(kind)::text)
  AND (sqlc.narg(open)::boolean IS NULL OR (e.status IN ('active', 'treating', 'stable')) = sqlc.narg(open)::boolean)
  AND (sqlc.narg(active_since)::date IS NULL OR e.ended_on IS NULL OR e.ended_on >= sqlc.narg(active_since)::date)
  AND (sqlc.narg(active_until)::date IS NULL OR e.started_on <= sqlc.narg(active_until)::date)
ORDER BY COALESCE(s.last_record_at, e.started_on::timestamptz) DESC, e.id DESC;

-- name: GetEpisode :one
SELECT sqlc.embed(e), t.name AS disease_name,
       COALESCE(s.record_count, 0)::int AS record_count,
       COALESCE(s.last_record_at, 'epoch'::timestamptz)::timestamptz AS last_record_at,
       COALESCE(s.cost_total, 0)::bigint AS cost_total_cents
FROM episodes e
JOIN disease_tags t ON t.id = e.disease_tag_id
LEFT JOIN LATERAL (
    SELECT count(*) AS record_count, max(r.occurred_at) AS last_record_at, sum(r.cost_cents) AS cost_total
    FROM records r WHERE r.episode_id = e.id
) s ON true
WHERE e.family_id = @family_id AND e.id = @id;

-- name: GetEpisodeForUpdate :one
SELECT * FROM episodes WHERE family_id = @family_id AND id = @id FOR UPDATE;

-- name: InsertEpisode :one
INSERT INTO episodes (id, family_id, member_id, disease_tag_id, name, kind, status, started_on, ended_on)
VALUES (@id, @family_id, @member_id, @disease_tag_id, @name, @kind, @status, @started_on, @ended_on)
RETURNING *;

-- name: UpdateEpisode :one
UPDATE episodes SET
    disease_tag_id = @disease_tag_id,
    name = @name,
    kind = @kind,
    status = @status,
    started_on = @started_on,
    ended_on = @ended_on,
    updated_at = now()
WHERE family_id = @family_id AND id = @id
RETURNING *;

-- name: DeleteEpisode :execrows
DELETE FROM episodes WHERE family_id = @family_id AND id = @id;

-- name: ClearFlareOutsideLong :exec
UPDATE records SET is_flare = false, updated_at = now()
WHERE family_id = @family_id AND episode_id = @episode_id AND is_flare;

-- name: ListLongEpisodeRefs :many
SELECT e.id, e.member_id, e.name, t.name AS disease_name, e.kind, e.status
FROM episodes e
JOIN disease_tags t ON t.id = e.disease_tag_id
WHERE e.family_id = @family_id AND e.member_id = ANY(@member_ids::uuid[]) AND e.kind = 'long'
ORDER BY e.started_on, e.id;

-- name: CountEpisodesSince :many
SELECT member_id, count(*)::int AS episode_count
FROM episodes
WHERE family_id = @family_id AND member_id = ANY(@member_ids::uuid[])
  AND (ended_on IS NULL OR ended_on >= @since::date)
GROUP BY member_id;

-- name: EpisodeRecordStats :many
SELECT r.episode_id::uuid AS episode_id,
       bool_or(r.temperature IS NOT NULL) AS has_temperature,
       COALESCE(max(r.temperature), 0)::float8 AS max_temperature,
       count(*) FILTER (WHERE r.type = 'visit')::int AS visit_count,
       COALESCE(array_agg(DISTINCT r.med_name) FILTER (WHERE r.med_name IS NOT NULL), '{}')::text[] AS medications
FROM records r
WHERE r.family_id = @family_id AND r.episode_id = ANY(@episode_ids::uuid[])
GROUP BY r.episode_id;
