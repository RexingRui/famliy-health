// Package auth handles password hashing (bcrypt, cost 12) and cookie sessions
// (random 32-byte token, only its SHA-256 stored, 30-day sliding expiry).
package auth
