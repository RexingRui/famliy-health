package service

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/store"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
	"github.com/rexingrui/famliy-health/internal/timex"
)

// ---------- Disease tags ----------

func (s *Service) ListDiseaseTags(ctx context.Context, p auth.Principal) ([]dbgen.DiseaseTag, error) {
	return s.store.ListDiseaseTags(ctx, &p.FamilyID)
}

// EnsureDiseaseTag returns the visible tag with this name, creating a family tag if needed.
func (s *Service) EnsureDiseaseTag(ctx context.Context, p auth.Principal, name string) (tag dbgen.DiseaseTag, created bool, err error) {
	err = s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		tag, created, err = ensureTag(ctx, q, p.FamilyID, name)
		return err
	})
	return tag, created, err
}

func ensureTag(ctx context.Context, q *dbgen.Queries, family uuid.UUID, name string) (dbgen.DiseaseTag, bool, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n == 0 || n > 30 {
		return dbgen.DiseaseTag{}, false, errs.Validation("病种名称不能为空，且不超过 30 个字", map[string]string{"diseaseName": "invalid"})
	}
	tag, err := q.FindDiseaseTagByName(ctx, dbgen.FindDiseaseTagByNameParams{Name: name, FamilyID: &family})
	if err == nil {
		return tag, false, nil
	}
	if !store.IsNotFound(err) {
		return tag, false, err
	}
	tag, err = q.InsertDiseaseTag(ctx, dbgen.InsertDiseaseTagParams{ID: newID(), FamilyID: &family, Name: name})
	return tag, err == nil, err
}

func resolveTag(ctx context.Context, q *dbgen.Queries, family uuid.UUID, id *uuid.UUID, name *string) (dbgen.DiseaseTag, error) {
	switch {
	case id != nil:
		tag, err := q.GetDiseaseTag(ctx, dbgen.GetDiseaseTagParams{ID: *id, FamilyID: &family})
		if store.IsNotFound(err) {
			return tag, errs.Validation("病种不存在", map[string]string{"diseaseTagId": "not_found"})
		}
		return tag, err
	case name != nil:
		tag, _, err := ensureTag(ctx, q, family, *name)
		return tag, err
	default:
		return dbgen.DiseaseTag{}, errs.Validation("请选择或填写病种", map[string]string{"diseaseName": "required"})
	}
}

// ---------- Episodes ----------

func defaultEpisodeName(disease string, kind dbgen.EpisodeKind, startedOn time.Time) string {
	if kind == dbgen.EpisodeKindLong {
		return disease
	}
	return fmt.Sprintf("%s · %s", disease, timex.DateOf(startedOn).Format("2006-01"))
}

func defaultStatus(kind dbgen.EpisodeKind) dbgen.EpisodeStatus {
	if kind == dbgen.EpisodeKindLong {
		return dbgen.EpisodeStatusTreating
	}
	return dbgen.EpisodeStatusActive
}

func statusAllowed(kind dbgen.EpisodeKind, st dbgen.EpisodeStatus) bool {
	switch kind {
	case dbgen.EpisodeKindShort:
		return st == dbgen.EpisodeStatusActive || st == dbgen.EpisodeStatusRecovered
	case dbgen.EpisodeKindLong:
		return st == dbgen.EpisodeStatusTreating || st == dbgen.EpisodeStatusStable || st == dbgen.EpisodeStatusEnded
	}
	return false
}

// longStatusFor maps a short-episode status when it becomes long (e.g. repeated wheezing
// diagnosed as asthma): 进行中→治疗中, 已康复→稳定期.
func longStatusFor(st dbgen.EpisodeStatus) dbgen.EpisodeStatus {
	if st == dbgen.EpisodeStatusRecovered {
		return dbgen.EpisodeStatusStable
	}
	return dbgen.EpisodeStatusTreating
}

type episodeFields struct {
	tag       dbgen.DiseaseTag
	name      string
	kind      dbgen.EpisodeKind
	status    dbgen.EpisodeStatus
	startedOn time.Time
	endedOn   *time.Time
}

// normalize validates fields and keeps ended_on consistent with status: open episodes have
// no end date; closing one without a date ends it today.
func (f *episodeFields) normalize() error {
	var fe errs.Fields
	f.name = strings.TrimSpace(f.name)
	if f.name == "" {
		f.name = defaultEpisodeName(f.tag.Name, f.kind, f.startedOn)
	}
	if utf8.RuneCountInString(f.name) > 50 {
		fe.Add("name", "too_long", "病程名称不超过 50 个字")
	}
	if !f.kind.Valid() {
		fe.Add("kind", "invalid", "病程类型不正确")
	} else if !statusAllowed(f.kind, f.status) {
		fe.Add("status", "invalid_for_kind", "该状态不适用于这种病程")
	}
	f.startedOn = timex.DateOf(f.startedOn)
	today := timex.Today()
	if f.startedOn.After(today) {
		fe.Add("startedOn", "in_future", "开始日期不能晚于今天")
	}
	if IsOpenStatus(f.status) {
		f.endedOn = nil
	} else {
		if f.endedOn == nil {
			f.endedOn = &today
		}
		end := timex.DateOf(*f.endedOn)
		f.endedOn = &end
		if end.Before(f.startedOn) {
			fe.Add("endedOn", "before_start", "结束日期不能早于开始日期")
		}
	}
	return fe.Err()
}

func (s *Service) createEpisode(ctx context.Context, q *dbgen.Queries, p auth.Principal, memberID uuid.UUID, f episodeFields) (dbgen.Episode, error) {
	if err := f.normalize(); err != nil {
		return dbgen.Episode{}, err
	}
	return q.InsertEpisode(ctx, dbgen.InsertEpisodeParams{
		ID: newID(), FamilyID: p.FamilyID, MemberID: memberID, DiseaseTagID: f.tag.ID, Name: f.name,
		Kind: f.kind, Status: f.status, StartedOn: f.startedOn, EndedOn: f.endedOn,
	})
}

// createNewEpisode handles the inline NewEpisode used by record creation and batch assignment.
func (s *Service) createNewEpisode(ctx context.Context, q *dbgen.Queries, p auth.Principal, memberID uuid.UUID, in api.NewEpisode) (dbgen.Episode, error) {
	tag, err := resolveTag(ctx, q, p.FamilyID, in.DiseaseTagId, in.DiseaseName)
	if err != nil {
		return dbgen.Episode{}, err
	}
	kind := dbgen.EpisodeKind(in.Kind)
	f := episodeFields{tag: tag, kind: kind, status: defaultStatus(kind), startedOn: timex.Today()}
	if in.Name != nil {
		f.name = *in.Name
	}
	if in.StartedOn != nil {
		f.startedOn = in.StartedOn.Time
	}
	return s.createEpisode(ctx, q, p, memberID, f)
}

func (s *Service) loadEpisode(ctx context.Context, q *dbgen.Queries, family, id uuid.UUID) (EpisodeView, error) {
	row, err := q.GetEpisode(ctx, dbgen.GetEpisodeParams{FamilyID: family, ID: id})
	if err != nil {
		return EpisodeView{}, notFound(err, "病程不存在")
	}
	return episodeView(row.Episode, row.DiseaseName, row.RecordCount, row.LastRecordAt, row.CostTotalCents), nil
}

func (s *Service) GetEpisode(ctx context.Context, p auth.Principal, id uuid.UUID) (EpisodeView, error) {
	return s.loadEpisode(ctx, s.store.Queries, p.FamilyID, id)
}

type EpisodeFilter struct {
	MemberID     *uuid.UUID
	DiseaseTagID *uuid.UUID
	Kind         *dbgen.EpisodeKind
	Open         *bool
	ActiveSince  *time.Time
	ActiveUntil  *time.Time
}

func (s *Service) listEpisodes(ctx context.Context, q *dbgen.Queries, family uuid.UUID, f EpisodeFilter) ([]EpisodeView, error) {
	var kind *string
	if f.Kind != nil {
		kind = ptr(string(*f.Kind))
	}
	rows, err := q.ListEpisodes(ctx, dbgen.ListEpisodesParams{
		FamilyID: family, MemberID: f.MemberID, DiseaseTagID: f.DiseaseTagID, Kind: kind, Open: f.Open,
		ActiveSince: f.ActiveSince, ActiveUntil: f.ActiveUntil,
	})
	if err != nil {
		return nil, err
	}
	out := make([]EpisodeView, len(rows))
	for i, r := range rows {
		out[i] = episodeView(r.Episode, r.DiseaseName, r.RecordCount, r.LastRecordAt, r.CostTotalCents)
	}
	return out, nil
}

func (s *Service) ListEpisodes(ctx context.Context, p auth.Principal, f EpisodeFilter) ([]EpisodeView, error) {
	return s.listEpisodes(ctx, s.store.Queries, p.FamilyID, f)
}

func (s *Service) CreateEpisode(ctx context.Context, p auth.Principal, in api.EpisodeCreate) (EpisodeView, error) {
	var view EpisodeView
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		if _, err := q.GetMember(ctx, dbgen.GetMemberParams{FamilyID: p.FamilyID, ID: in.MemberId}); err != nil {
			if store.IsNotFound(err) {
				return errs.Validation("成员不存在", map[string]string{"memberId": "not_found"})
			}
			return err
		}
		tag, err := resolveTag(ctx, q, p.FamilyID, in.DiseaseTagId, in.DiseaseName)
		if err != nil {
			return err
		}
		kind := dbgen.EpisodeKind(in.Kind)
		f := episodeFields{tag: tag, kind: kind, status: defaultStatus(kind), startedOn: timex.Today()}
		if in.Name != nil {
			f.name = *in.Name
		}
		if in.Status != nil {
			f.status = dbgen.EpisodeStatus(*in.Status)
		}
		if in.StartedOn != nil {
			f.startedOn = in.StartedOn.Time
		}
		if in.EndedOn != nil {
			f.endedOn = &in.EndedOn.Time
		}
		e, err := s.createEpisode(ctx, q, p, in.MemberId, f)
		if err != nil {
			return err
		}
		view, err = s.loadEpisode(ctx, q, p.FamilyID, e.ID)
		return err
	})
	return view, err
}

func (s *Service) UpdateEpisode(ctx context.Context, p auth.Principal, id uuid.UUID, in api.EpisodePatch) (EpisodeView, error) {
	var view EpisodeView
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		e, err := q.GetEpisodeForUpdate(ctx, dbgen.GetEpisodeForUpdateParams{FamilyID: p.FamilyID, ID: id})
		if err != nil {
			return notFound(err, "病程不存在")
		}
		oldTag, err := q.GetDiseaseTag(ctx, dbgen.GetDiseaseTagParams{ID: e.DiseaseTagID, FamilyID: &p.FamilyID})
		if err != nil {
			return err
		}
		f := episodeFields{tag: oldTag, name: e.Name, kind: e.Kind, status: e.Status, startedOn: e.StartedOn, endedOn: e.EndedOn}

		if in.DiseaseTagId != nil || in.DiseaseName != nil {
			if f.tag, err = resolveTag(ctx, q, p.FamilyID, in.DiseaseTagId, in.DiseaseName); err != nil {
				return err
			}
		}
		if in.StartedOn != nil {
			f.startedOn = in.StartedOn.Time
		}
		if in.Kind != nil && dbgen.EpisodeKind(*in.Kind) != e.Kind {
			if e.Kind == dbgen.EpisodeKindLong {
				return errs.Validation("长期病程不能改回短期病程", map[string]string{"kind": "long_to_short"})
			}
			f.kind = dbgen.EpisodeKindLong
			f.status = longStatusFor(e.Status)
		}
		if in.Status != nil {
			f.status = dbgen.EpisodeStatus(*in.Status)
		}
		applyNullableDate(in.EndedOn, &f.endedOn)

		// A name still equal to the generated default follows disease/kind/start changes
		// (“发烧” diagnosed as “支原体肺炎”); a custom name is kept.
		switch {
		case in.Name != nil:
			f.name = *in.Name
		case e.Name == defaultEpisodeName(oldTag.Name, e.Kind, e.StartedOn):
			f.name = ""
		}
		if err := f.normalize(); err != nil {
			return err
		}
		if _, err := q.UpdateEpisode(ctx, dbgen.UpdateEpisodeParams{
			FamilyID: p.FamilyID, ID: id, DiseaseTagID: f.tag.ID, Name: f.name, Kind: f.kind,
			Status: f.status, StartedOn: f.startedOn, EndedOn: f.endedOn,
		}); err != nil {
			return err
		}
		view, err = s.loadEpisode(ctx, q, p.FamilyID, id)
		return err
	})
	return view, err
}

// DeleteEpisode returns its records to the inbox (FK ON DELETE SET NULL); flare marks only
// make sense inside a long episode, so they are cleared first.
func (s *Service) DeleteEpisode(ctx context.Context, p auth.Principal, id uuid.UUID) error {
	return s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		if err := q.ClearFlareOutsideLong(ctx, dbgen.ClearFlareOutsideLongParams{FamilyID: p.FamilyID, EpisodeID: &id}); err != nil {
			return err
		}
		n, err := q.DeleteEpisode(ctx, dbgen.DeleteEpisodeParams{FamilyID: p.FamilyID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			return errs.NotFound("病程不存在")
		}
		return nil
	})
}
