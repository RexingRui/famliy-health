package service

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
	"github.com/rexingrui/famliy-health/internal/timex"
)

// ---------- Calendar ----------

type TypeCounts struct {
	Symptom, Temperature, Medication, Visit, Treatment, Exam, Other, Untyped int
}

type CalendarDay struct {
	Date        time.Time
	Counts      TypeCounts
	MaxSeverity *int
	Flare       bool
}

type Calendar struct {
	From, To time.Time // To is exclusive internally; handlers show the last day
	Days     []CalendarDay
}

func calendarDay(day time.Time, c TypeCounts, maxSeverity int32, flare bool) CalendarDay {
	d := CalendarDay{Date: timex.DateOf(day), Counts: c, Flare: flare}
	if maxSeverity >= 0 {
		d.MaxSeverity = ptr(int(maxSeverity))
	}
	return d
}

func (s *Service) calendar(ctx context.Context, family uuid.UUID, episodeID, memberID *uuid.UUID, month string) (Calendar, error) {
	from, to, err := timex.ParseMonth(month)
	if err != nil {
		return Calendar{}, errs.BadRequest("月份格式应为 2026-09")
	}
	rows, err := s.store.CalendarDays(ctx, dbgen.CalendarDaysParams{
		Tz: timex.Zone, FamilyID: family, EpisodeID: episodeID, MemberID: memberID, FromTime: from, ToTime: to,
	})
	if err != nil {
		return Calendar{}, err
	}
	cal := Calendar{From: from, To: to, Days: make([]CalendarDay, len(rows))}
	for i, r := range rows {
		cal.Days[i] = calendarDay(r.Day, TypeCounts{
			int(r.Symptom), int(r.Temperature), int(r.Medication), int(r.Visit),
			int(r.Treatment), int(r.Exam), int(r.Other), int(r.Untyped),
		}, r.MaxSeverity, r.Flare)
	}
	return cal, nil
}

func (s *Service) EpisodeCalendar(ctx context.Context, p auth.Principal, id uuid.UUID, month string) (Calendar, error) {
	if _, err := s.store.GetEpisodeForUpdate(ctx, dbgen.GetEpisodeForUpdateParams{FamilyID: p.FamilyID, ID: id}); err != nil {
		return Calendar{}, notFound(err, "病程不存在")
	}
	return s.calendar(ctx, p.FamilyID, &id, nil, month)
}

func (s *Service) MemberCalendar(ctx context.Context, p auth.Principal, id uuid.UUID, month string) (Calendar, error) {
	if _, err := s.store.GetMember(ctx, dbgen.GetMemberParams{FamilyID: p.FamilyID, ID: id}); err != nil {
		return Calendar{}, notFound(err, "成员不存在")
	}
	return s.calendar(ctx, p.FamilyID, nil, &id, month)
}

// ---------- Trend ----------

type TrendPoint struct {
	RecordID   uuid.UUID
	OccurredAt time.Time
	Value      float64
}

type Trend struct {
	Temperature, Severity []TrendPoint
}

func (s *Service) EpisodeTrend(ctx context.Context, p auth.Principal, id uuid.UUID, from, to *time.Time) (Trend, error) {
	if _, err := s.store.GetEpisodeForUpdate(ctx, dbgen.GetEpisodeForUpdateParams{FamilyID: p.FamilyID, ID: id}); err != nil {
		return Trend{}, notFound(err, "病程不存在")
	}
	rows, err := s.store.TrendPoints(ctx, dbgen.TrendPointsParams{FamilyID: p.FamilyID, EpisodeID: &id, FromTime: from, ToTime: to})
	if err != nil {
		return Trend{}, err
	}
	t := Trend{Temperature: []TrendPoint{}, Severity: []TrendPoint{}}
	for _, r := range rows {
		if r.Temperature != nil {
			t.Temperature = append(t.Temperature, TrendPoint{r.ID, r.OccurredAt, *r.Temperature})
		}
		if r.Severity != nil {
			t.Severity = append(t.Severity, TrendPoint{r.ID, r.OccurredAt, float64(*r.Severity)})
		}
	}
	return t, nil
}

// ---------- Home ----------

type EpisodeSummary struct {
	Episode           EpisodeView
	LatestTemperature *dbgen.Record
	LastMedication    *dbgen.Record
	Week              []CalendarDay
}

type HomeMember struct {
	Member               MemberView
	OpenEpisodes         []EpisodeSummary
	RecentRecords        []RecordView
	EpisodeCountLastYear int
}

type Home struct {
	Members    []HomeMember
	InboxCount int
}

const recentRecordsPerMember = 4

func (s *Service) Home(ctx context.Context, p auth.Principal) (Home, error) {
	q := s.store.Queries
	fam := p.FamilyID
	ms, err := q.ListMembers(ctx, dbgen.ListMembersParams{FamilyID: fam})
	if err != nil {
		return Home{}, err
	}
	members, err := s.memberViews(ctx, q, fam, ms)
	if err != nil {
		return Home{}, err
	}
	inbox, err := q.CountInbox(ctx, fam)
	if err != nil {
		return Home{}, err
	}
	home := Home{Members: make([]HomeMember, len(members)), InboxCount: int(inbox)}
	if len(members) == 0 {
		return home, nil
	}

	memberIDs := make([]uuid.UUID, len(ms))
	for i, m := range ms {
		memberIDs[i] = m.ID
	}
	open, err := s.listEpisodes(ctx, q, fam, EpisodeFilter{Open: ptr(true)})
	if err != nil {
		return Home{}, err
	}
	episodeIDs := make([]uuid.UUID, len(open))
	for i, e := range open {
		episodeIDs[i] = e.ID
	}

	temps, err := q.LatestTemperatureByEpisodes(ctx, dbgen.LatestTemperatureByEpisodesParams{FamilyID: fam, EpisodeIds: episodeIDs})
	if err != nil {
		return Home{}, err
	}
	meds, err := q.LatestMedicationByEpisodes(ctx, dbgen.LatestMedicationByEpisodesParams{FamilyID: fam, EpisodeIds: episodeIDs})
	if err != nil {
		return Home{}, err
	}
	weekFrom, weekTo := timex.WeekOf(timex.Now())
	weekRows, err := q.CalendarDaysByEpisodes(ctx, dbgen.CalendarDaysByEpisodesParams{
		Tz: timex.Zone, FamilyID: fam, EpisodeIds: episodeIDs, FromTime: weekFrom, ToTime: weekTo,
	})
	if err != nil {
		return Home{}, err
	}
	recent, err := q.ListRecentRecordsByMembers(ctx, dbgen.ListRecentRecordsByMembersParams{FamilyID: fam, MemberIds: memberIDs, PerMember: recentRecordsPerMember})
	if err != nil {
		return Home{}, err
	}
	recentViews, err := s.recordViews(ctx, q, fam, recent)
	if err != nil {
		return Home{}, err
	}
	counts, err := q.CountEpisodesSince(ctx, dbgen.CountEpisodesSinceParams{FamilyID: fam, MemberIds: memberIDs, Since: timex.Today().AddDate(-1, 0, 0)})
	if err != nil {
		return Home{}, err
	}

	tempBy := map[uuid.UUID]*dbgen.Record{}
	for i := range temps {
		tempBy[*temps[i].EpisodeID] = &temps[i]
	}
	medBy := map[uuid.UUID]*dbgen.Record{}
	for i := range meds {
		medBy[*meds[i].EpisodeID] = &meds[i]
	}
	weekBy := map[uuid.UUID][]CalendarDay{}
	for _, r := range weekRows {
		weekBy[r.EpisodeID] = append(weekBy[r.EpisodeID], calendarDay(r.Day, TypeCounts{
			int(r.Symptom), int(r.Temperature), int(r.Medication), int(r.Visit),
			int(r.Treatment), int(r.Exam), int(r.Other), int(r.Untyped),
		}, r.MaxSeverity, r.Flare))
	}
	episodesBy := map[uuid.UUID][]EpisodeSummary{}
	for _, e := range open {
		week := weekBy[e.ID]
		if week == nil {
			week = []CalendarDay{}
		}
		episodesBy[e.MemberID] = append(episodesBy[e.MemberID], EpisodeSummary{
			Episode: e, LatestTemperature: tempBy[e.ID], LastMedication: medBy[e.ID], Week: week,
		})
	}
	recentBy := map[uuid.UUID][]RecordView{}
	for _, r := range recentViews {
		recentBy[r.MemberID] = append(recentBy[r.MemberID], r)
	}
	countBy := map[uuid.UUID]int{}
	for _, c := range counts {
		countBy[c.MemberID] = int(c.EpisodeCount)
	}

	for i, m := range members {
		hm := HomeMember{Member: m, OpenEpisodes: episodesBy[m.ID], RecentRecords: recentBy[m.ID], EpisodeCountLastYear: countBy[m.ID]}
		if hm.OpenEpisodes == nil {
			hm.OpenEpisodes = []EpisodeSummary{}
		}
		if hm.RecentRecords == nil {
			hm.RecentRecords = []RecordView{}
		}
		home.Members[i] = hm
	}
	return home, nil
}

// ---------- By disease ----------

type DiseaseEpisode struct {
	Episode        EpisodeView
	MaxTemperature *float64
	Medications    []string
	VisitCount     int
}

type MedicationCount struct {
	Name  string
	Count int
}

type DiseaseSummary struct {
	DiseaseTagID     uuid.UUID
	DiseaseName      string
	RecoveredAvgDays *float64
	MaxDays          *int
	TopMedications   []MedicationCount
	Episodes         []DiseaseEpisode
}

const topMedications = 5

// ByDisease groups a member's episodes by disease for the “按病种” view, e.g. how many colds
// in the last year, how long each lasted and which medicines were used.
func (s *Service) ByDisease(ctx context.Context, p auth.Principal, memberID uuid.UUID, rng string) ([]DiseaseSummary, error) {
	q := s.store.Queries
	if _, err := q.GetMember(ctx, dbgen.GetMemberParams{FamilyID: p.FamilyID, ID: memberID}); err != nil {
		return nil, notFound(err, "成员不存在")
	}
	var since *time.Time
	switch rng {
	case "", "1y":
		since = ptr(timex.Today().AddDate(-1, 0, 0))
	case "3y":
		since = ptr(timex.Today().AddDate(-3, 0, 0))
	case "all":
	default:
		return nil, errs.BadRequest("时间段只能是 1y、3y 或 all")
	}
	eps, err := s.listEpisodes(ctx, q, p.FamilyID, EpisodeFilter{MemberID: &memberID, ActiveSince: since})
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, len(eps))
	for i, e := range eps {
		ids[i] = e.ID
	}
	stats, err := q.EpisodeRecordStats(ctx, dbgen.EpisodeRecordStatsParams{FamilyID: p.FamilyID, EpisodeIds: ids})
	if err != nil {
		return nil, err
	}
	statBy := map[uuid.UUID]dbgen.EpisodeRecordStatsRow{}
	for _, st := range stats {
		statBy[st.EpisodeID] = st
	}

	byTag := map[uuid.UUID]*DiseaseSummary{}
	var order []uuid.UUID
	for _, e := range eps {
		sum := byTag[e.DiseaseTagID]
		if sum == nil {
			sum = &DiseaseSummary{DiseaseTagID: e.DiseaseTagID, DiseaseName: e.DiseaseName}
			byTag[e.DiseaseTagID] = sum
			order = append(order, e.DiseaseTagID)
		}
		de := DiseaseEpisode{Episode: e, Medications: []string{}}
		if st, ok := statBy[e.ID]; ok {
			if st.HasTemperature {
				de.MaxTemperature = ptr(st.MaxTemperature)
			}
			de.Medications = st.Medications
			sort.Strings(de.Medications)
			de.VisitCount = int(st.VisitCount)
		}
		sum.Episodes = append(sum.Episodes, de)
	}

	out := make([]DiseaseSummary, 0, len(order))
	for _, id := range order {
		sum := byTag[id]
		sort.SliceStable(sum.Episodes, func(i, j int) bool {
			return sum.Episodes[i].Episode.StartedOn.After(sum.Episodes[j].Episode.StartedOn)
		})
		medCount := map[string]int{}
		var closedDays, closed, maxDays int
		for _, de := range sum.Episodes {
			days := de.Episode.Days()
			maxDays = max(maxDays, days)
			if !de.Episode.Open() {
				closedDays += days
				closed++
			}
			for _, m := range de.Medications {
				medCount[m]++
			}
		}
		sum.MaxDays = ptr(maxDays)
		if closed > 0 {
			sum.RecoveredAvgDays = ptr(math.Round(float64(closedDays)/float64(closed)*10) / 10)
		}
		sum.TopMedications = []MedicationCount{}
		for name, n := range medCount {
			sum.TopMedications = append(sum.TopMedications, MedicationCount{name, n})
		}
		sort.Slice(sum.TopMedications, func(i, j int) bool {
			a, b := sum.TopMedications[i], sum.TopMedications[j]
			return a.Count > b.Count || (a.Count == b.Count && a.Name < b.Name)
		})
		if len(sum.TopMedications) > topMedications {
			sum.TopMedications = sum.TopMedications[:topMedications]
		}
		out = append(out, *sum)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if len(out[i].Episodes) != len(out[j].Episodes) {
			return len(out[i].Episodes) > len(out[j].Episodes)
		}
		return out[i].Episodes[0].Episode.StartedOn.After(out[j].Episodes[0].Episode.StartedOn)
	})
	return out, nil
}
