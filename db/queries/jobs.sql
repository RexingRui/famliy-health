-- name: EnqueueJob :exec
INSERT INTO jobs (id, kind, payload, run_after) VALUES (@id, @kind, @payload, @run_after);

-- name: ClaimJob :one
UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
WHERE id = (
    SELECT j.id FROM jobs j
    WHERE j.status = 'pending' AND j.run_after <= now()
    ORDER BY j.run_after, j.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: CompleteJob :exec
UPDATE jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = @id;

-- name: RetryJob :exec
UPDATE jobs SET status = 'pending', run_after = @run_after, last_error = @last_error, updated_at = now() WHERE id = @id;

-- name: FailJob :exec
UPDATE jobs SET status = 'failed', last_error = @last_error, updated_at = now() WHERE id = @id;

-- name: ResetRunningJobs :execrows
UPDATE jobs SET status = 'pending', updated_at = now() WHERE status = 'running';

-- name: DeleteFinishedJobs :execrows
DELETE FROM jobs WHERE status = 'done' AND updated_at < @before;
