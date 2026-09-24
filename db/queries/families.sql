-- name: GetFamily :one
SELECT * FROM families WHERE id = $1;
