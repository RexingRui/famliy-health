package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/store"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
)

const (
	SessionTTL = 30 * 24 * time.Hour
	// Sliding renewal writes at most once per interval instead of on every request.
	sessionRenewEvery = time.Hour
)

type Me = dbgen.GetMeRow

type LoginResult struct {
	Token     string
	ExpiresAt time.Time
	Me        Me
}

func (s *Service) Login(ctx context.Context, username, password, ip, userAgent string) (LoginResult, error) {
	if s.limiter.Locked(ip) {
		return LoginResult{}, errs.TooManyRequests("尝试次数过多，请 15 分钟后再试")
	}
	acct, err := s.store.GetAccountByUsername(ctx, strings.TrimSpace(username))
	if err != nil && !store.IsNotFound(err) {
		return LoginResult{}, err
	}
	if !auth.CheckPassword(acct.PasswordHash, password) {
		s.limiter.Fail(ip)
		return LoginResult{}, errs.Unauthorized("用户名或密码不正确")
	}
	s.limiter.Success(ip)

	token, id, err := auth.NewSessionToken()
	if err != nil {
		return LoginResult{}, err
	}
	expires := time.Now().Add(SessionTTL)
	var me Me
	err = s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		if err := q.InsertSession(ctx, dbgen.InsertSessionParams{ID: id, AccountID: acct.ID, ExpiresAt: expires, UserAgent: truncate(userAgent, 300)}); err != nil {
			return err
		}
		if err := q.TouchAccountLogin(ctx, acct.ID); err != nil {
			return err
		}
		p, err := q.GetSessionPrincipal(ctx, id)
		if err != nil {
			return notFound(err, "账号没有关联家庭")
		}
		me, err = q.GetMe(ctx, dbgen.GetMeParams{AccountID: acct.ID, FamilyID: p.FamilyID})
		return err
	})
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{Token: token, ExpiresAt: expires, Me: me}, nil
}

// Authenticate resolves a session cookie. renewed is non-nil when the expiry slid forward
// and the cookie should be re-issued.
func (s *Service) Authenticate(ctx context.Context, token string) (p auth.Principal, renewed *time.Time, err error) {
	if token == "" {
		return p, nil, errs.Unauthorized("请先登录")
	}
	id := auth.SessionID(token)
	row, err := s.store.GetSessionPrincipal(ctx, id)
	if store.IsNotFound(err) {
		return p, nil, errs.Unauthorized("登录已过期，请重新登录")
	}
	if err != nil {
		return p, nil, err
	}
	p = auth.Principal{AccountID: row.AccountID, FamilyID: row.FamilyID, SessionID: id}
	if time.Since(row.LastSeenAt) > sessionRenewEvery {
		exp := time.Now().Add(SessionTTL)
		if err := s.store.TouchSession(ctx, dbgen.TouchSessionParams{ID: id, ExpiresAt: exp}); err != nil {
			return p, nil, err
		}
		renewed = &exp
	}
	return p, renewed, nil
}

func (s *Service) Logout(ctx context.Context, p auth.Principal, all bool) error {
	if all {
		_, err := s.store.DeleteAccountSessions(ctx, p.AccountID)
		return err
	}
	return s.store.DeleteSession(ctx, p.SessionID)
}

func (s *Service) Me(ctx context.Context, p auth.Principal) (Me, error) {
	me, err := s.store.GetMe(ctx, dbgen.GetMeParams{AccountID: p.AccountID, FamilyID: p.FamilyID})
	return me, notFound(err, "账号不存在")
}

// CreateAccount is used by the CLI. The first account creates the family; later ones join it.
func (s *Service) CreateAccount(ctx context.Context, username, password, displayName, familyName string) (dbgen.Account, error) {
	username = strings.TrimSpace(username)
	if username == "" || len(username) > 64 {
		return dbgen.Account{}, errs.BadRequest("用户名不能为空且不超过 64 个字符")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return dbgen.Account{}, errs.BadRequest(err.Error())
	}
	if displayName == "" {
		displayName = username
	}
	var acct dbgen.Account
	err = s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		if _, err := q.GetAccountByUsername(ctx, username); err == nil {
			return errs.Conflict("用户名已存在")
		} else if !store.IsNotFound(err) {
			return err
		}
		fam, err := q.FirstFamily(ctx)
		if store.IsNotFound(err) {
			fam, err = q.InsertFamily(ctx, dbgen.InsertFamilyParams{ID: newID(), Name: familyName})
		}
		if err != nil {
			return err
		}
		acct, err = q.InsertAccount(ctx, dbgen.InsertAccountParams{ID: newID(), Username: username, PasswordHash: hash, DisplayName: displayName})
		if err != nil {
			return err
		}
		return q.InsertFamilyMembership(ctx, dbgen.InsertFamilyMembershipParams{FamilyID: fam.ID, AccountID: acct.ID})
	})
	return acct, err
}

func (s *Service) SetPassword(ctx context.Context, username, password string) error {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return errs.BadRequest(err.Error())
	}
	n, err := s.store.SetAccountPassword(ctx, dbgen.SetAccountPasswordParams{Username: username, PasswordHash: hash})
	if err != nil {
		return err
	}
	if n == 0 {
		return errs.NotFound("用户名不存在")
	}
	acct, err := s.store.GetAccountByUsername(ctx, username)
	if err != nil {
		return err
	}
	_, err = s.store.DeleteAccountSessions(ctx, acct.ID)
	return err
}

// DeleteFamilyData removes the family with every member, record and file (irreversible).
func (s *Service) DeleteFamilyData(ctx context.Context, familyID uuid.UUID) error {
	keys, err := s.store.ListFamilyStorageKeys(ctx, familyID)
	if err != nil {
		return err
	}
	if _, err := s.store.DeleteFamily(ctx, familyID); err != nil {
		return err
	}
	for _, k := range keys {
		for _, key := range []*string{&k.OriginalKey, k.StorageKey} {
			if key != nil && *key != "" {
				_ = s.files.Delete(ctx, *key)
			}
		}
	}
	return nil
}

func (s *Service) PurgeExpiredSessions(ctx context.Context) (int64, error) {
	return s.store.DeleteExpiredSessions(ctx)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
