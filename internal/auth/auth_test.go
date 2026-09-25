package auth

import (
	"testing"
	"time"
)

func TestPassword(t *testing.T) {
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("short password accepted")
	}
	h, err := HashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "correct horse") || CheckPassword(h, "wrong") || CheckPassword("", "correct horse") {
		t.Fatal("CheckPassword mismatch")
	}
}

func TestSessionTokenHashing(t *testing.T) {
	token, id, err := NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if string(SessionID(token)) != string(id) || len(id) != 32 || len(token) < 40 {
		t.Fatalf("token=%q id=%x", token, id)
	}
}

func TestLoginLimiter(t *testing.T) {
	now := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	l := NewLoginLimiter()
	l.Now = func() time.Time { return now }

	for range 4 {
		l.Fail("1.2.3.4")
	}
	if l.Locked("1.2.3.4") {
		t.Fatal("locked after 4 failures")
	}
	l.Fail("1.2.3.4")
	if !l.Locked("1.2.3.4") || l.Locked("5.6.7.8") {
		t.Fatal("lock state wrong after 5 failures")
	}

	now = now.Add(15 * time.Minute)
	if l.Locked("1.2.3.4") {
		t.Fatal("still locked after 15 minutes")
	}
	l.Fail("1.2.3.4")
	if l.Locked("1.2.3.4") {
		t.Fatal("counter not reset after lock expired")
	}

	l.Success("1.2.3.4")
	for range 4 {
		l.Fail("1.2.3.4")
	}
	if l.Locked("1.2.3.4") {
		t.Fatal("success did not reset the counter")
	}
}
