package handler

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/httpctx"
)

// Operations reachable without a session. File and print-data accept a print token instead.
var publicOperations = map[string]bool{
	"Healthz":           true,
	"Login":             true,
	"GetAttachmentFile": true,
	"GetPrintData":      true,
}

// AuthMiddleware attaches the session principal to the context, requires it for every
// non-public operation, and re-issues the cookie when the session slides forward.
func (h *Handler) AuthMiddleware(f api.StrictHandlerFunc, operationID string) api.StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, req any) (any, error) {
		if operationID == "Healthz" {
			return f(ctx, w, r, req)
		}
		var token string
		if c, err := r.Cookie(auth.CookieName); err == nil {
			token = c.Value
		}
		p, renewed, err := h.svc.Authenticate(ctx, token)
		if err != nil {
			if publicOperations[operationID] {
				if token != "" && operationID != "Login" {
					h.clearCookie(w)
				}
				return f(ctx, w, r, req)
			}
			if _, ok := errs.As(err); ok && token != "" {
				h.clearCookie(w)
			}
			return nil, err
		}
		httpctx.SetAccount(ctx, p.AccountID.String())
		if renewed != nil {
			h.setCookie(w, token, *renewed)
		}
		return f(auth.WithPrincipal(ctx, p), w, r, req)
	}
}

func (h *Handler) setCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     h.cookiePath(),
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: auth.CookieName, Value: "", Path: h.cookiePath(), MaxAge: -1,
		HttpOnly: true, Secure: h.cookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

func principal(ctx context.Context) (auth.Principal, error) {
	p, ok := auth.FromContext(ctx)
	if !ok {
		return p, errs.Unauthorized("请先登录")
	}
	return p, nil
}

// clientIP relies on chi's RealIP middleware, which trusts X-Forwarded-For/X-Real-IP. That is
// safe here because the app port is only reachable through Caddy, which overwrites them.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

// cookieResponse wraps a JSON response to also set or clear the session cookie.
type loginResponse struct {
	h       *Handler
	token   string
	expires time.Time
	body    api.Me
}

func (l loginResponse) VisitLoginResponse(w http.ResponseWriter) error {
	l.h.setCookie(w, l.token, l.expires)
	return api.Login200JSONResponse(l.body).VisitLoginResponse(w)
}

type logoutResponse struct{ h *Handler }

func (l logoutResponse) VisitLogoutResponse(w http.ResponseWriter) error {
	l.h.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Handler) Login(ctx context.Context, req api.LoginRequestObject) (api.LoginResponseObject, error) {
	if req.Body == nil {
		return nil, errs.BadRequest("请填写用户名和密码")
	}
	r := httpctx.Request(ctx)
	ip, ua := "", ""
	if r != nil {
		ip, ua = clientIP(r), r.UserAgent()
	}
	res, err := h.svc.Login(ctx, req.Body.Username, req.Body.Password, ip, ua)
	if err != nil {
		return nil, err
	}
	httpctx.SetAccount(ctx, res.Me.AccountID.String())
	return loginResponse{h: h, token: res.Token, expires: res.ExpiresAt, body: toMe(res.Me)}, nil
}

func (h *Handler) Logout(ctx context.Context, req api.LogoutRequestObject) (api.LogoutResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	all := req.Params.All != nil && *req.Params.All
	if err := h.svc.Logout(ctx, p, all); err != nil {
		return nil, err
	}
	return logoutResponse{h}, nil
}

func (h *Handler) GetMe(ctx context.Context, _ api.GetMeRequestObject) (api.GetMeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	me, err := h.svc.Me(ctx, p)
	if err != nil {
		return nil, err
	}
	return api.GetMe200JSONResponse(toMe(me)), nil
}
