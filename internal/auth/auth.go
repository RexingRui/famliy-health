// Package auth holds the primitives for login: bcrypt passwords, opaque session tokens
// (only their SHA-256 is stored), the request principal and the login rate limiter.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	CookieName = "sid"
	bcryptCost = 12
)

func HashPassword(password string) (string, error) {
	if len(password) < 8 {
		return "", errors.New("密码至少 8 位")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(h), err
}

// dummyHash keeps login timing the same whether or not the username exists.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("timing-equaliser"), bcryptCost)

// CheckPassword compares in constant-ish time; pass hash "" when the account does not exist.
func CheckPassword(hash, password string) bool {
	if hash == "" {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// NewSessionToken returns the cookie value and the ID stored in the database.
func NewSessionToken() (token string, id []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, SessionID(token), nil
}

func SessionID(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

type Principal struct {
	AccountID uuid.UUID
	FamilyID  uuid.UUID
	SessionID []byte
}

type principalKey struct{}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

func FromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	return p, ok
}
