package service

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/report"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
	"github.com/rexingrui/famliy-health/internal/timex"
)

type Reports struct {
	Signer    *report.Signer
	Gotenberg *report.Gotenberg
	// PrintBaseURL is where Gotenberg opens the print page, e.g. http://app:8080.
	PrintBaseURL string
}

func (s *Service) SetReports(r Reports) { s.reports = r }

const (
	ReportEpisode = "episode"
	ReportMember  = "member"
)

type ReportRequest struct {
	Type   string
	ID     uuid.UUID
	From   *time.Time // dates
	To     *time.Time
	Photos string
}

type PrintData struct {
	Request        ReportRequest
	GeneratedAt    time.Time
	Member         MemberView
	Episode        *EpisodeView
	Episodes       []EpisodeView
	Records        []RecordView
	CostTotalCents int64
	Token          *string
}

func (r *ReportRequest) validate() error {
	var fe errs.Fields
	if r.Type != ReportEpisode && r.Type != ReportMember {
		fe.Add("type", "invalid", "报告类型只能是病程报告或成员健康档案")
	}
	if r.ID == uuid.Nil {
		fe.Add("id", "required", "请选择病程或成员")
	}
	switch r.Photos {
	case "":
		r.Photos = "none"
	case "none", "thumbnail", "appendix":
	default:
		fe.Add("photos", "invalid", "照片选项不正确")
	}
	if r.From != nil && r.To != nil && timex.DateOf(*r.To).Before(timex.DateOf(*r.From)) {
		fe.Add("to", "before_from", "结束日期不能早于开始日期")
	}
	return fe.Err()
}

// resolveMember returns the member the report is about (checking family ownership).
func (s *Service) resolveMember(ctx context.Context, family uuid.UUID, r ReportRequest) (uuid.UUID, error) {
	if r.Type == ReportEpisode {
		e, err := s.store.GetEpisodeForUpdate(ctx, dbgen.GetEpisodeForUpdateParams{FamilyID: family, ID: r.ID})
		if err != nil {
			return uuid.Nil, notFound(err, "病程不存在")
		}
		return e.MemberID, nil
	}
	if _, err := s.store.GetMember(ctx, dbgen.GetMemberParams{FamilyID: family, ID: r.ID}); err != nil {
		return uuid.Nil, notFound(err, "成员不存在")
	}
	return r.ID, nil
}

func (s *Service) buildPrintData(ctx context.Context, family uuid.UUID, r ReportRequest) (PrintData, error) {
	if err := r.validate(); err != nil {
		return PrintData{}, err
	}
	memberID, err := s.resolveMember(ctx, family, r)
	if err != nil {
		return PrintData{}, err
	}
	q := s.store.Queries
	m, err := q.GetMember(ctx, dbgen.GetMemberParams{FamilyID: family, ID: memberID})
	if err != nil {
		return PrintData{}, err
	}
	mv, err := s.memberView(ctx, q, family, m)
	if err != nil {
		return PrintData{}, err
	}
	data := PrintData{Request: r, GeneratedAt: timex.Now(), Member: mv, Episodes: []EpisodeView{}, Records: []RecordView{}}

	var from, to *time.Time
	if r.From != nil {
		from = ptr(timex.DateOf(*r.From))
	}
	if r.To != nil {
		to = ptr(timex.EndOfDay(*r.To))
	}

	if r.Type == ReportEpisode {
		e, err := s.loadEpisode(ctx, q, family, r.ID)
		if err != nil {
			return PrintData{}, err
		}
		data.Episode = &e
		recs, err := q.ListEpisodeRecordsAsc(ctx, dbgen.ListEpisodeRecordsAscParams{FamilyID: family, EpisodeID: &r.ID, FromTime: from, ToTime: to})
		if err != nil {
			return PrintData{}, err
		}
		if data.Records, err = s.recordViews(ctx, q, family, recs); err != nil {
			return PrintData{}, err
		}
		for _, rec := range recs {
			if rec.CostCents != nil {
				data.CostTotalCents += int64(*rec.CostCents)
			}
		}
		return data, nil
	}

	var until *time.Time
	if r.To != nil {
		until = ptr(timex.DateOf(*r.To))
	}
	eps, err := s.listEpisodes(ctx, q, family, EpisodeFilter{MemberID: &memberID, ActiveSince: from, ActiveUntil: until})
	if err != nil {
		return PrintData{}, err
	}
	data.Episodes = eps
	for _, e := range eps {
		data.CostTotalCents += e.CostTotalCents
	}
	return data, nil
}

// PrintData serves the export preview and browser printing, authorised by the session.
func (s *Service) PrintData(ctx context.Context, p auth.Principal, r ReportRequest) (PrintData, error) {
	return s.buildPrintData(ctx, p.FamilyID, r)
}

// PrintDataByToken serves Gotenberg, which has no session, authorised by a print token.
func (s *Service) PrintDataByToken(ctx context.Context, token string) (PrintData, error) {
	c, err := s.VerifyPrintToken(token)
	if err != nil {
		return PrintData{}, err
	}
	r := ReportRequest{Type: c.Type, ID: c.ID, Photos: c.Photos}
	if c.From != "" {
		if t, err := time.Parse(time.DateOnly, c.From); err == nil {
			r.From = &t
		}
	}
	if c.To != "" {
		if t, err := time.Parse(time.DateOnly, c.To); err == nil {
			r.To = &t
		}
	}
	data, err := s.buildPrintData(ctx, c.Family, r)
	if err != nil {
		return PrintData{}, err
	}
	data.Token = &token
	return data, nil
}

func (s *Service) VerifyPrintToken(token string) (report.Claims, error) {
	if s.reports.Signer == nil {
		return report.Claims{}, errs.Unavailable("报告服务未配置", nil)
	}
	c, err := s.reports.Signer.Verify(token)
	if err != nil {
		return c, errs.Unauthorized("打印链接已失效")
	}
	return c, nil
}

// Export renders the report through Gotenberg and returns the PDF stream and a file name.
func (s *Service) Export(ctx context.Context, p auth.Principal, r ReportRequest) (io.ReadCloser, string, error) {
	if s.reports.Signer == nil || s.reports.Gotenberg == nil || s.reports.PrintBaseURL == "" {
		return nil, "", errs.Unavailable("报告服务未配置", nil)
	}
	data, err := s.buildPrintData(ctx, p.FamilyID, r)
	if err != nil {
		return nil, "", err
	}
	c := report.Claims{Family: p.FamilyID, Account: p.AccountID, Type: r.Type, ID: r.ID, Member: data.Member.ID, Photos: data.Request.Photos}
	if r.From != nil {
		c.From = r.From.Format(time.DateOnly)
	}
	if r.To != nil {
		c.To = r.To.Format(time.DateOnly)
	}
	token, err := s.reports.Signer.Sign(c)
	if err != nil {
		return nil, "", err
	}
	pageURL := fmt.Sprintf("%s/print/%s/%s?token=%s", strings.TrimRight(s.reports.PrintBaseURL, "/"), r.Type, r.ID, url.QueryEscape(token))
	pdf, err := s.reports.Gotenberg.ConvertURL(ctx, pageURL)
	if err != nil {
		return nil, "", errs.Unavailable("生成 PDF 失败，请稍后再试", err)
	}
	return pdf, reportFileName(data), nil
}

func reportFileName(d PrintData) string {
	name := "健康档案-" + d.Member.Nickname
	if d.Episode != nil {
		name = "病程报告-" + d.Member.Nickname + "-" + d.Episode.Name
	}
	name += "-" + d.GeneratedAt.Format("20060102")
	return strings.NewReplacer("/", "-", "\\", "-", " · ", "-", " ", "", "\"", "").Replace(name) + ".pdf"
}
