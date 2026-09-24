// Package jobs polls the jobs table (SELECT ... FOR UPDATE SKIP LOCKED) and runs
// background work such as audio transcoding, retrying with 1/5/30 minute backoff.
package jobs
