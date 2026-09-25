// Package service holds the business rules. Handlers call it with a Principal; it reads
// and writes through store (transactions start here) and returns views for handlers to map.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/storage"
	"github.com/rexingrui/famliy-health/internal/store"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
	"github.com/rexingrui/famliy-health/internal/timex"
)

type Service struct {
	store   *store.Store
	files   storage.Storage
	limiter *auth.LoginLimiter
	// wakeJobs nudges the job runner after a transaction that enqueued work commits.
	wakeJobs func()
	reports  Reports
}

func New(s *store.Store, files storage.Storage, wakeJobs func()) *Service {
	if wakeJobs == nil {
		wakeJobs = func() {}
	}
	return &Service{store: s, files: files, limiter: auth.NewLoginLimiter(), wakeJobs: wakeJobs}
}

func (s *Service) Store() *store.Store { return s.store }

func newID() uuid.UUID {
	id, err := uuid.NewV7()
	if err != nil {
		panic(err) // only fails if the system RNG fails
	}
	return id
}

// notFound turns pgx.ErrNoRows into a 404 with msg and passes other errors through.
func notFound(err error, msg string) error {
	if store.IsNotFound(err) {
		return errs.NotFound(msg)
	}
	return err
}

// ---------- Views returned to handlers ----------

type EpisodeView struct {
	dbgen.Episode
	DiseaseName    string
	RecordCount    int
	LastRecordAt   *time.Time
	CostTotalCents int64
}

func IsOpenStatus(s dbgen.EpisodeStatus) bool {
	return s == dbgen.EpisodeStatusActive || s == dbgen.EpisodeStatusTreating || s == dbgen.EpisodeStatusStable
}

func (e EpisodeView) Open() bool { return IsOpenStatus(e.Status) }

// Days is "第 N 天" while open and the total duration once ended.
func (e EpisodeView) Days() int {
	end := timex.Today()
	if !e.Open() && e.EndedOn != nil {
		end = *e.EndedOn
	}
	return max(1, timex.DaysBetween(e.StartedOn, end)+1)
}

const recoveryPromptAfter = 14 * 24 * time.Hour

// SuggestRecovered: a short episode with no new record for 14 days prompts “是否已康复”.
func (e EpisodeView) SuggestRecovered() bool {
	if e.Kind != dbgen.EpisodeKindShort || e.Status != dbgen.EpisodeStatusActive {
		return false
	}
	last := timex.DateOf(e.StartedOn)
	if e.LastRecordAt != nil {
		last = *e.LastRecordAt
	}
	return timex.Now().Sub(last) > recoveryPromptAfter
}

func episodeView(e dbgen.Episode, disease string, count int32, last time.Time, cost int64) EpisodeView {
	v := EpisodeView{Episode: e, DiseaseName: disease, RecordCount: int(count), CostTotalCents: cost}
	if count > 0 {
		v.LastRecordAt = &last
	}
	return v
}

type MemberView struct {
	dbgen.Member
	LongEpisodes []dbgen.ListLongEpisodeRefsRow
}

type RecordView struct {
	dbgen.Record
	Details     RecordDetails
	Attachments []dbgen.Attachment
}

// Backfilled: occurred and entered more than an hour apart (“补录”).
func (r RecordView) Backfilled() bool {
	d := r.CreatedAt.Sub(r.OccurredAt)
	return d > time.Hour || d < -time.Hour
}

type RecordDetails struct {
	Hospital    string `json:"hospital,omitempty"`
	Department  string `json:"department,omitempty"`
	Doctor      string `json:"doctor,omitempty"`
	Item        string `json:"item,omitempty"`
	Institution string `json:"institution,omitempty"`
}

func (d RecordDetails) empty() bool { return d == RecordDetails{} }

func (d RecordDetails) trimmed() RecordDetails {
	return RecordDetails{
		Hospital:    strings.TrimSpace(d.Hospital),
		Department:  strings.TrimSpace(d.Department),
		Doctor:      strings.TrimSpace(d.Doctor),
		Item:        strings.TrimSpace(d.Item),
		Institution: strings.TrimSpace(d.Institution),
	}
}

func decodeDetails(b []byte) RecordDetails {
	var d RecordDetails
	if len(b) > 0 {
		_ = json.Unmarshal(b, &d)
	}
	return d
}

func encodeDetails(d RecordDetails) []byte {
	b, _ := json.Marshal(d)
	return b
}

// recordViews loads attachments for records in one query.
func (s *Service) recordViews(ctx context.Context, q *dbgen.Queries, family uuid.UUID, records []dbgen.Record) ([]RecordView, error) {
	views := make([]RecordView, len(records))
	if len(records) == 0 {
		return views, nil
	}
	ids := make([]uuid.UUID, len(records))
	for i, r := range records {
		ids[i] = r.ID
	}
	atts, err := q.ListAttachmentsByRecords(ctx, dbgen.ListAttachmentsByRecordsParams{FamilyID: family, RecordIds: ids})
	if err != nil {
		return nil, err
	}
	byRecord := map[uuid.UUID][]dbgen.Attachment{}
	for _, a := range atts {
		byRecord[*a.RecordID] = append(byRecord[*a.RecordID], a)
	}
	for i, r := range records {
		views[i] = RecordView{Record: r, Details: decodeDetails(r.Details), Attachments: byRecord[r.ID]}
		if views[i].Attachments == nil {
			views[i].Attachments = []dbgen.Attachment{}
		}
	}
	return views, nil
}

func (s *Service) recordView(ctx context.Context, q *dbgen.Queries, family uuid.UUID, r dbgen.Record) (RecordView, error) {
	v, err := s.recordViews(ctx, q, family, []dbgen.Record{r})
	if err != nil {
		return RecordView{}, err
	}
	return v[0], nil
}

var errSentinelRollback = errors.New("rollback")
