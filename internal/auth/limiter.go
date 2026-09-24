package auth

import (
	"sync"
	"time"
)

// LoginLimiter locks an IP for LockFor after MaxFailures consecutive failed logins.
type LoginLimiter struct {
	MaxFailures int
	LockFor     time.Duration
	Now         func() time.Time

	mu      sync.Mutex
	entries map[string]*limitEntry
}

type limitEntry struct {
	failures    int
	lockedUntil time.Time
	lastSeen    time.Time
}

func NewLoginLimiter() *LoginLimiter {
	return &LoginLimiter{MaxFailures: 5, LockFor: 15 * time.Minute, Now: time.Now, entries: map[string]*limitEntry{}}
}

// Locked reports whether key is currently locked out.
func (l *LoginLimiter) Locked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.entries[key]
	return e != nil && l.Now().Before(e.lockedUntil)
}

func (l *LoginLimiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Now()
	l.prune(now)
	e := l.entries[key]
	if e == nil {
		e = &limitEntry{}
		l.entries[key] = e
	}
	if !e.lockedUntil.IsZero() && !now.Before(e.lockedUntil) {
		e.failures, e.lockedUntil = 0, time.Time{}
	}
	e.failures++
	e.lastSeen = now
	if e.failures >= l.MaxFailures {
		e.lockedUntil = now.Add(l.LockFor)
	}
}

func (l *LoginLimiter) Success(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}

func (l *LoginLimiter) prune(now time.Time) {
	if len(l.entries) < 1024 {
		return
	}
	for k, e := range l.entries {
		if now.Sub(e.lastSeen) > l.LockFor && now.After(e.lockedUntil) {
			delete(l.entries, k)
		}
	}
}
