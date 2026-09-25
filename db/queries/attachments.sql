-- name: GetAttachment :one
SELECT * FROM attachments WHERE family_id = @family_id AND id = @id;

-- name: GetAttachmentAnyFamily :one
SELECT * FROM attachments WHERE id = @id;

-- name: GetAttachmentOwner :one
SELECT a.family_id, r.member_id AS record_member_id, r.episode_id AS record_episode_id
FROM attachments a
LEFT JOIN records r ON r.id = a.record_id
WHERE a.id = @id;

-- name: InsertAttachment :one
INSERT INTO attachments (
    id, family_id, record_id, kind, status, original_key, storage_key, mime, size_bytes,
    duration_ms, width, height, caption, sort_order
) VALUES (
    @id, @family_id, @record_id, @kind, @status, @original_key, @storage_key, @mime, @size_bytes,
    @duration_ms, @width, @height, @caption, @sort_order
)
ON CONFLICT (id) DO NOTHING
RETURNING *;

-- name: ListAttachmentsByRecords :many
SELECT * FROM attachments
WHERE family_id = @family_id AND record_id = ANY(@record_ids::uuid[])
ORDER BY record_id, sort_order, created_at, id;

-- name: CountRecordPhotos :one
SELECT count(*)::int FROM attachments WHERE record_id = @record_id AND kind = 'photo';

-- name: NextAttachmentSortOrder :one
SELECT COALESCE(max(sort_order) + 1, 0)::int FROM attachments WHERE record_id = @record_id;

-- name: UpdateAttachmentMeta :one
UPDATE attachments SET caption = @caption, sort_order = @sort_order, updated_at = now()
WHERE family_id = @family_id AND id = @id
RETURNING *;

-- name: SetAttachmentProcessed :exec
UPDATE attachments SET status = 'ready', storage_key = @storage_key, mime = @mime, duration_ms = @duration_ms, updated_at = now()
WHERE id = @id;

-- name: SetAttachmentStatus :exec
UPDATE attachments SET status = @status, updated_at = now() WHERE id = @id;

-- name: DeleteAttachment :one
DELETE FROM attachments WHERE family_id = @family_id AND id = @id RETURNING *;

-- name: ListCaptionsByRecord :many
SELECT caption FROM attachments WHERE record_id = @record_id AND caption IS NOT NULL AND caption <> '' ORDER BY sort_order, created_at;
