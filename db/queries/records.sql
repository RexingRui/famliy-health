-- name: GetRecord :one
SELECT * FROM records WHERE family_id = @family_id AND id = @id;

-- name: GetRecordForUpdate :one
SELECT * FROM records WHERE family_id = @family_id AND id = @id FOR UPDATE;

-- name: GetRecordFamily :one
SELECT family_id FROM records WHERE id = @id;

-- name: InsertRecord :one
INSERT INTO records (
    id, family_id, member_id, episode_id, type, occurred_at, body, is_flare, severity, temperature,
    med_name, med_dose, med_unit, cost_cents, details, search_text, created_by
) VALUES (
    @id, @family_id, @member_id, @episode_id, @type, @occurred_at, @body, @is_flare, @severity, @temperature,
    @med_name, @med_dose, @med_unit, @cost_cents, @details, @search_text, @created_by
)
ON CONFLICT (id) DO NOTHING
RETURNING *;

-- name: UpdateRecord :one
UPDATE records SET
    member_id = @member_id,
    episode_id = @episode_id,
    type = @type,
    occurred_at = @occurred_at,
    body = @body,
    is_flare = @is_flare,
    severity = @severity,
    temperature = @temperature,
    med_name = @med_name,
    med_dose = @med_dose,
    med_unit = @med_unit,
    cost_cents = @cost_cents,
    details = @details,
    search_text = @search_text,
    updated_at = now()
WHERE family_id = @family_id AND id = @id
RETURNING *;

-- name: SetRecordSearchText :exec
UPDATE records SET search_text = @search_text, updated_at = now() WHERE family_id = @family_id AND id = @id;

-- name: DeleteRecord :execrows
DELETE FROM records WHERE family_id = @family_id AND id = @id;

-- name: ListRecords :many
SELECT * FROM records r
WHERE r.family_id = @family_id
  AND (sqlc.narg(member_id)::uuid IS NULL OR r.member_id = sqlc.narg(member_id)::uuid)
  AND (sqlc.narg(episode_id)::uuid IS NULL OR r.episode_id = sqlc.narg(episode_id)::uuid)
  AND (NOT @inbox_only::boolean OR r.episode_id IS NULL)
  AND (cardinality(@types::text[]) = 0 OR r.type::text = ANY(@types::text[]))
  AND (NOT @flare_only::boolean OR r.is_flare)
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR r.occurred_at >= sqlc.narg(from_time)::timestamptz)
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR r.occurred_at <= sqlc.narg(to_time)::timestamptz)
  AND (sqlc.narg(pattern)::text IS NULL OR r.search_text ILIKE sqlc.narg(pattern)::text)
  AND (sqlc.narg(cursor_time)::timestamptz IS NULL
       OR (r.occurred_at, r.id) < (sqlc.narg(cursor_time)::timestamptz, sqlc.narg(cursor_id)::uuid))
ORDER BY r.occurred_at DESC, r.id DESC
LIMIT @lim;

-- name: ListEpisodeRecordsAsc :many
SELECT * FROM records
WHERE family_id = @family_id AND episode_id = @episode_id
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR occurred_at >= sqlc.narg(from_time)::timestamptz)
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR occurred_at <= sqlc.narg(to_time)::timestamptz)
ORDER BY occurred_at, id;

-- name: CountInbox :one
SELECT count(*)::int FROM records WHERE family_id = @family_id AND episode_id IS NULL;

-- name: ListRecentRecordsByMembers :many
SELECT * FROM records
WHERE id IN (
    SELECT x.id FROM (
        SELECT r.id, row_number() OVER (PARTITION BY r.member_id ORDER BY r.occurred_at DESC, r.id DESC) AS rn
        FROM records r
        WHERE r.family_id = @family_id AND r.member_id = ANY(@member_ids::uuid[])
    ) x WHERE x.rn <= @per_member::int
)
ORDER BY occurred_at DESC, id DESC;

-- name: LatestTemperatureByEpisodes :many
SELECT DISTINCT ON (episode_id) * FROM records
WHERE family_id = @family_id AND episode_id = ANY(@episode_ids::uuid[]) AND temperature IS NOT NULL
ORDER BY episode_id, occurred_at DESC, id DESC;

-- name: LatestMedicationByEpisodes :many
SELECT DISTINCT ON (episode_id) * FROM records
WHERE family_id = @family_id AND episode_id = ANY(@episode_ids::uuid[]) AND type = 'medication' AND med_name IS NOT NULL
ORDER BY episode_id, occurred_at DESC, id DESC;

-- name: LastMedication :one
SELECT * FROM records
WHERE family_id = @family_id AND member_id = @member_id AND type = 'medication'
  AND med_name = @med_name AND occurred_at <= now()
ORDER BY occurred_at DESC, id DESC
LIMIT 1;

-- name: CalendarDays :many
SELECT (r.occurred_at AT TIME ZONE @tz::text)::date AS day,
       count(*) FILTER (WHERE r.type = 'symptom')::int AS symptom,
       count(*) FILTER (WHERE r.type = 'temperature')::int AS temperature,
       count(*) FILTER (WHERE r.type = 'medication')::int AS medication,
       count(*) FILTER (WHERE r.type = 'visit')::int AS visit,
       count(*) FILTER (WHERE r.type = 'treatment')::int AS treatment,
       count(*) FILTER (WHERE r.type = 'exam')::int AS exam,
       count(*) FILTER (WHERE r.type = 'other')::int AS other,
       count(*) FILTER (WHERE r.type IS NULL)::int AS untyped,
       COALESCE(max(r.severity), -1)::int AS max_severity,
       bool_or(r.is_flare) AS flare
FROM records r
WHERE r.family_id = @family_id
  AND (sqlc.narg(episode_id)::uuid IS NULL OR r.episode_id = sqlc.narg(episode_id)::uuid)
  AND (sqlc.narg(member_id)::uuid IS NULL OR r.member_id = sqlc.narg(member_id)::uuid)
  AND r.occurred_at >= @from_time AND r.occurred_at < @to_time
GROUP BY 1
ORDER BY 1;

-- name: CalendarDaysByEpisodes :many
SELECT r.episode_id::uuid AS episode_id,
       (r.occurred_at AT TIME ZONE @tz::text)::date AS day,
       count(*) FILTER (WHERE r.type = 'symptom')::int AS symptom,
       count(*) FILTER (WHERE r.type = 'temperature')::int AS temperature,
       count(*) FILTER (WHERE r.type = 'medication')::int AS medication,
       count(*) FILTER (WHERE r.type = 'visit')::int AS visit,
       count(*) FILTER (WHERE r.type = 'treatment')::int AS treatment,
       count(*) FILTER (WHERE r.type = 'exam')::int AS exam,
       count(*) FILTER (WHERE r.type = 'other')::int AS other,
       count(*) FILTER (WHERE r.type IS NULL)::int AS untyped,
       COALESCE(max(r.severity), -1)::int AS max_severity,
       bool_or(r.is_flare) AS flare
FROM records r
WHERE r.family_id = @family_id AND r.episode_id = ANY(@episode_ids::uuid[])
  AND r.occurred_at >= @from_time AND r.occurred_at < @to_time
GROUP BY 1, 2
ORDER BY 1, 2;

-- name: TrendPoints :many
SELECT id, occurred_at, temperature, severity FROM records
WHERE family_id = @family_id AND episode_id = @episode_id
  AND (temperature IS NOT NULL OR severity IS NOT NULL)
  AND (sqlc.narg(from_time)::timestamptz IS NULL OR occurred_at >= sqlc.narg(from_time)::timestamptz)
  AND (sqlc.narg(to_time)::timestamptz IS NULL OR occurred_at <= sqlc.narg(to_time)::timestamptz)
ORDER BY occurred_at, id;

-- name: ListRecordsByIDsForUpdate :many
SELECT * FROM records WHERE family_id = @family_id AND id = ANY(@ids::uuid[]) FOR UPDATE;

-- name: AssignRecords :execrows
UPDATE records SET
    episode_id = sqlc.narg(episode_id)::uuid,
    is_flare = is_flare AND @keep_flare::boolean,
    updated_at = now()
WHERE family_id = @family_id AND id = ANY(@ids::uuid[]);

-- name: ListRecordStorageKeys :many
SELECT id, original_key, storage_key FROM attachments WHERE family_id = @family_id AND record_id = @record_id;
