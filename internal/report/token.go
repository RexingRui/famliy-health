package report

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// TokenTTL bounds how long Gotenberg may use a print token.
const TokenTTL = 5 * time.Minute

// Claims scope a print token to one report of one family. They are signed, not stored.
type Claims struct {
	Family  uuid.UUID `json:"fam"`
	Account uuid.UUID `json:"acct"`
	Type    string    `json:"type"`
	ID      uuid.UUID `json:"id"`
	Member  uuid.UUID `json:"member"`
	From    string    `json:"from,omitempty"`
	To      string    `json:"to,omitempty"`
	Photos  string    `json:"photos"`
	Expires int64     `json:"exp"`
}

var ErrInvalidToken = errors.New("invalid print token")

type Signer struct {
	key []byte
	now func() time.Time
}

func NewSigner(secret string) (*Signer, error) {
	if len(secret) < 32 {
		return nil, errors.New("PRINT_TOKEN_SECRET must be at least 32 characters")
	}
	return &Signer{key: []byte(secret), now: time.Now}, nil
}

// The "print." prefix keeps these MACs from ever validating as another token type.
func (s *Signer) mac(payload string) []byte {
	h := hmac.New(sha256.New, s.key)
	h.Write([]byte("print."))
	h.Write([]byte(payload))
	return h.Sum(nil)
}

func (s *Signer) Sign(c Claims) (string, error) {
	c.Expires = s.now().Add(TokenTTL).Unix()
	b, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(b)
	return payload + "." + base64.RawURLEncoding.EncodeToString(s.mac(payload)), nil
}

func (s *Signer) Verify(token string) (Claims, error) {
	payload, sig, ok := strings.Cut(token, ".")
	if !ok {
		return Claims{}, ErrInvalidToken
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, s.mac(payload)) {
		return Claims{}, ErrInvalidToken
	}
	b, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var c Claims
	if err := json.Unmarshal(b, &c); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if s.now().Unix() > c.Expires {
		return Claims{}, ErrInvalidToken
	}
	return c, nil
}
