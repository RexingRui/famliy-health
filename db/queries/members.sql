-- name: ListMembers :many
SELECT * FROM members
WHERE family_id = @family_id AND (@include_archived::boolean OR archived_at IS NULL)
ORDER BY sort_order, created_at;

-- name: GetMember :one
SELECT * FROM members WHERE family_id = @family_id AND id = @id;

-- name: GetMemberForUpdate :one
SELECT * FROM members WHERE family_id = @family_id AND id = @id FOR UPDATE;

-- name: NextMemberSortOrder :one
SELECT COALESCE(max(sort_order) + 1, 0)::int FROM members WHERE family_id = @family_id;

-- name: InsertMember :one
INSERT INTO members (id, family_id, nickname, relation, gender, birth_date, avatar_id, allergies, notes, blood_type, sort_order)
VALUES (@id, @family_id, @nickname, @relation, @gender, @birth_date, @avatar_id, @allergies, @notes, @blood_type, @sort_order)
RETURNING *;

-- name: UpdateMember :one
UPDATE members SET
    nickname = @nickname,
    relation = @relation,
    gender = @gender,
    birth_date = @birth_date,
    avatar_id = @avatar_id,
    allergies = @allergies,
    notes = @notes,
    blood_type = @blood_type,
    sort_order = @sort_order,
    updated_at = now()
WHERE family_id = @family_id AND id = @id
RETURNING *;

-- name: SetMemberArchived :one
UPDATE members SET archived_at = @archived_at, updated_at = now()
WHERE family_id = @family_id AND id = @id
RETURNING *;

-- name: DeleteMember :execrows
DELETE FROM members WHERE family_id = @family_id AND id = @id;

-- name: ListMemberStorageKeys :many
SELECT a.id, a.original_key, a.storage_key
FROM attachments a
LEFT JOIN records r ON r.id = a.record_id
WHERE a.family_id = @family_id
  AND (r.member_id = @member_id OR a.id = (SELECT m.avatar_id FROM members m WHERE m.family_id = @family_id AND m.id = @member_id));

-- name: DeleteAttachmentsByIDs :exec
DELETE FROM attachments WHERE family_id = @family_id AND id = ANY(@ids::uuid[]);
