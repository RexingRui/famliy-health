package handler

import (
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/service"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
	"github.com/rexingrui/famliy-health/internal/timex"
)

func date(t time.Time) openapi_types.Date { return openapi_types.Date{Time: t} }

func ts(t time.Time) time.Time { return timex.In(t) }

func tsPtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	v := timex.In(*t)
	return &v
}

func intPtr[T int16 | int32](v *T) *int {
	if v == nil {
		return nil
	}
	i := int(*v)
	return &i
}

func strPtrNonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func toMe(m service.Me) api.Me {
	return api.Me{
		Account: api.Account{Id: m.AccountID, Username: m.Username, DisplayName: m.DisplayName},
		Family:  api.Family{Id: m.FamilyID, Name: m.FamilyName},
	}
}

// mapper builds API responses; URLs it emits include the deployment base path.
type mapper struct {
	base string
}

func (m mapper) attachmentURL(a dbgen.Attachment) string {
	return m.base + "/api/attachments/" + a.ID.String() + "/file"
}

func (m mapper) toAttachment(a dbgen.Attachment) api.Attachment {
	out := api.Attachment{
		Id: a.ID, RecordId: a.RecordID, Kind: api.AttachmentKind(a.Kind), Status: api.AttachmentStatus(a.Status),
		Mime: a.Mime, SizeBytes: a.SizeBytes, DurationMs: intPtr(a.DurationMs), Width: intPtr(a.Width),
		Height: intPtr(a.Height), Caption: a.Caption, SortOrder: int(a.SortOrder), Url: m.attachmentURL(a),
		CreatedAt: ts(a.CreatedAt),
	}
	if a.Kind != dbgen.AttachmentKindAudio && a.StorageKey != nil {
		out.ThumbUrl = strPtrNonEmpty(m.attachmentURL(a) + "?variant=thumb")
	}
	return out
}

func (m mapper) toMember(mv service.MemberView) api.Member {
	out := api.Member{
		Id: mv.ID, Nickname: mv.Nickname, Relation: api.MemberRelation(mv.Relation), Gender: api.Gender(mv.Gender),
		BirthDate: date(mv.BirthDate), AvatarId: mv.AvatarID, Allergies: mv.Allergies, Notes: mv.Notes,
		SortOrder: int(mv.SortOrder), Archived: mv.ArchivedAt != nil, LongEpisodes: make([]api.EpisodeRef, len(mv.LongEpisodes)),
		CreatedAt: ts(mv.CreatedAt), UpdatedAt: ts(mv.UpdatedAt),
	}
	if mv.AvatarID != nil {
		out.AvatarUrl = strPtrNonEmpty(m.base + "/api/attachments/" + mv.AvatarID.String() + "/file?variant=thumb")
	}
	if mv.BloodType != nil {
		out.BloodType = (*api.BloodType)(mv.BloodType)
	}
	for i, e := range mv.LongEpisodes {
		out.LongEpisodes[i] = api.EpisodeRef{
			Id: e.ID, Name: e.Name, DiseaseName: e.DiseaseName, Kind: api.EpisodeKind(e.Kind), Status: api.EpisodeStatus(e.Status),
		}
	}
	return out
}

func (m mapper) toMembers(ms []service.MemberView) []api.Member {
	out := make([]api.Member, len(ms))
	for i, mv := range ms {
		out[i] = m.toMember(mv)
	}
	return out
}

func toEpisode(e service.EpisodeView) api.Episode {
	out := api.Episode{
		Id: e.ID, MemberId: e.MemberID, DiseaseTagId: e.DiseaseTagID, DiseaseName: e.DiseaseName, Name: e.Name,
		Kind: api.EpisodeKind(e.Kind), Status: api.EpisodeStatus(e.Status), Open: e.Open(),
		StartedOn: date(e.StartedOn), Days: e.Days(), RecordCount: e.RecordCount, LastRecordAt: tsPtr(e.LastRecordAt),
		CostTotalCents: int(e.CostTotalCents), SuggestRecovered: e.SuggestRecovered(),
		CreatedAt: ts(e.CreatedAt), UpdatedAt: ts(e.UpdatedAt),
	}
	if e.EndedOn != nil {
		d := date(*e.EndedOn)
		out.EndedOn = &d
	}
	return out
}

func toEpisodes(es []service.EpisodeView) []api.Episode {
	out := make([]api.Episode, len(es))
	for i, e := range es {
		out[i] = toEpisode(e)
	}
	return out
}

func toDetails(d service.RecordDetails) api.RecordDetails {
	return api.RecordDetails{
		Hospital: strPtrNonEmpty(d.Hospital), Department: strPtrNonEmpty(d.Department), Doctor: strPtrNonEmpty(d.Doctor),
		Item: strPtrNonEmpty(d.Item), Institution: strPtrNonEmpty(d.Institution),
	}
}

func (m mapper) toRecord(r service.RecordView) api.Record {
	out := api.Record{
		Id: r.ID, MemberId: r.MemberID, EpisodeId: r.EpisodeID, OccurredAt: ts(r.OccurredAt),
		CreatedAt: ts(r.CreatedAt), UpdatedAt: ts(r.UpdatedAt), Backfilled: r.Backfilled(), Body: r.Body,
		IsFlare: r.IsFlare, Severity: intPtr(r.Severity), Temperature: r.Temperature, MedName: r.MedName,
		MedDose: r.MedDose, CostCents: intPtr(r.CostCents), Details: toDetails(r.Details),
		Attachments: make([]api.Attachment, len(r.Attachments)),
	}
	if r.Type != nil {
		out.Type = (*api.RecordType)(r.Type)
	}
	if r.MedUnit != nil {
		out.MedUnit = (*api.MedUnit)(r.MedUnit)
	}
	for i, a := range r.Attachments {
		out.Attachments[i] = m.toAttachment(a)
	}
	return out
}

func (m mapper) toRecords(rs []service.RecordView) []api.Record {
	out := make([]api.Record, len(rs))
	for i, r := range rs {
		out[i] = m.toRecord(r)
	}
	return out
}

func toMedicationDose(r dbgen.Record, hoursSince float64) api.MedicationDose {
	out := api.MedicationDose{RecordId: r.ID, MedDose: r.MedDose, OccurredAt: ts(r.OccurredAt), HoursSince: hoursSince}
	if r.MedName != nil {
		out.MedName = *r.MedName
	}
	if r.MedUnit != nil {
		out.MedUnit = (*api.MedUnit)(r.MedUnit)
	}
	return out
}

func toCalendarDays(days []service.CalendarDay) []api.CalendarDay {
	out := make([]api.CalendarDay, len(days))
	for i, d := range days {
		c := d.Counts
		out[i] = api.CalendarDay{
			Date: date(d.Date), MaxSeverity: d.MaxSeverity, Flare: d.Flare,
			Counts: api.TypeCounts{
				Symptom: c.Symptom, Temperature: c.Temperature, Medication: c.Medication, Visit: c.Visit,
				Treatment: c.Treatment, Exam: c.Exam, Other: c.Other, Untyped: c.Untyped,
			},
		}
	}
	return out
}

func toCalendar(c service.Calendar) api.Calendar {
	return api.Calendar{From: date(c.From), To: date(c.To.AddDate(0, 0, -1)), Days: toCalendarDays(c.Days)}
}

func toTrendPoints(ps []service.TrendPoint) []api.TrendPoint {
	out := make([]api.TrendPoint, len(ps))
	for i, p := range ps {
		out[i] = api.TrendPoint{RecordId: p.RecordID, OccurredAt: ts(p.OccurredAt), Value: p.Value}
	}
	return out
}

func (m mapper) toHome(h service.Home) api.Home {
	out := api.Home{InboxCount: h.InboxCount, Members: make([]api.HomeMember, len(h.Members))}
	for i, hmv := range h.Members {
		hm := api.HomeMember{
			Member: m.toMember(hmv.Member), RecentRecords: m.toRecords(hmv.RecentRecords),
			EpisodeCountLastYear: hmv.EpisodeCountLastYear, OpenEpisodes: make([]api.EpisodeSummary, len(hmv.OpenEpisodes)),
		}
		for j, e := range hmv.OpenEpisodes {
			s := api.EpisodeSummary{Episode: toEpisode(e.Episode), Week: toCalendarDays(e.Week)}
			if t := e.LatestTemperature; t != nil && t.Temperature != nil {
				s.LatestTemperature = &api.TemperatureReading{RecordId: t.ID, Value: *t.Temperature, OccurredAt: ts(t.OccurredAt)}
			}
			if med := e.LastMedication; med != nil {
				d := toMedicationDose(*med, 0)
				d.HoursSince = hoursSince(med.OccurredAt)
				s.LastMedication = &d
			}
			hm.OpenEpisodes[j] = s
		}
		out.Members[i] = hm
	}
	return out
}

func hoursSince(t time.Time) float64 {
	return float64(int(timex.Now().Sub(t).Hours()*10+0.5)) / 10
}

func toByDisease(rng string, ds []service.DiseaseSummary) api.ByDisease {
	out := api.ByDisease{Range: api.ByDiseaseRange(rng), Diseases: make([]api.DiseaseSummary, len(ds))}
	for i, d := range ds {
		s := api.DiseaseSummary{
			DiseaseTagId: d.DiseaseTagID, DiseaseName: d.DiseaseName, EpisodeCount: len(d.Episodes),
			RecoveredAvgDays: d.RecoveredAvgDays, MaxDays: d.MaxDays,
			TopMedications: make([]api.MedicationCount, len(d.TopMedications)),
			Episodes:       make([]api.DiseaseEpisode, len(d.Episodes)),
		}
		for j, m := range d.TopMedications {
			s.TopMedications[j] = api.MedicationCount{Name: m.Name, Count: m.Count}
		}
		for j, e := range d.Episodes {
			s.Episodes[j] = api.DiseaseEpisode{
				Episode: toEpisode(e.Episode), MaxTemperature: e.MaxTemperature, Medications: e.Medications, VisitCount: e.VisitCount,
			}
		}
		out.Diseases[i] = s
	}
	return out
}

func (m mapper) toPrintData(d service.PrintData) api.PrintData {
	out := api.PrintData{
		Type: api.ReportType(d.Request.Type), GeneratedAt: ts(d.GeneratedAt), Photos: api.PhotoOption(d.Request.Photos),
		Member: m.toMember(d.Member), Episodes: toEpisodes(d.Episodes), Records: m.toRecords(d.Records),
		CostTotalCents: int(d.CostTotalCents), Token: d.Token,
	}
	if d.Request.From != nil {
		f := date(*d.Request.From)
		out.From = &f
	}
	if d.Request.To != nil {
		t := date(*d.Request.To)
		out.To = &t
	}
	if d.Episode != nil {
		e := toEpisode(*d.Episode)
		out.Episode = &e
	}
	return out
}
