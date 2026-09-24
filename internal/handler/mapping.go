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

func attachmentURL(a dbgen.Attachment) string {
	return "/api/attachments/" + a.ID.String() + "/file"
}

func toAttachment(a dbgen.Attachment) api.Attachment {
	out := api.Attachment{
		Id: a.ID, RecordId: a.RecordID, Kind: api.AttachmentKind(a.Kind), Status: api.AttachmentStatus(a.Status),
		Mime: a.Mime, SizeBytes: a.SizeBytes, DurationMs: intPtr(a.DurationMs), Width: intPtr(a.Width),
		Height: intPtr(a.Height), Caption: a.Caption, SortOrder: int(a.SortOrder), Url: attachmentURL(a),
		CreatedAt: ts(a.CreatedAt),
	}
	if a.Kind != dbgen.AttachmentKindAudio && a.StorageKey != nil {
		out.ThumbUrl = strPtrNonEmpty(attachmentURL(a) + "?variant=thumb")
	}
	return out
}

func toMember(m service.MemberView) api.Member {
	out := api.Member{
		Id: m.ID, Nickname: m.Nickname, Relation: api.MemberRelation(m.Relation), Gender: api.Gender(m.Gender),
		BirthDate: date(m.BirthDate), AvatarId: m.AvatarID, Allergies: m.Allergies, Notes: m.Notes,
		SortOrder: int(m.SortOrder), Archived: m.ArchivedAt != nil, LongEpisodes: make([]api.EpisodeRef, len(m.LongEpisodes)),
		CreatedAt: ts(m.CreatedAt), UpdatedAt: ts(m.UpdatedAt),
	}
	if m.AvatarID != nil {
		out.AvatarUrl = strPtrNonEmpty("/api/attachments/" + m.AvatarID.String() + "/file?variant=thumb")
	}
	if m.BloodType != nil {
		out.BloodType = (*api.BloodType)(m.BloodType)
	}
	for i, e := range m.LongEpisodes {
		out.LongEpisodes[i] = api.EpisodeRef{
			Id: e.ID, Name: e.Name, DiseaseName: e.DiseaseName, Kind: api.EpisodeKind(e.Kind), Status: api.EpisodeStatus(e.Status),
		}
	}
	return out
}

func toMembers(ms []service.MemberView) []api.Member {
	out := make([]api.Member, len(ms))
	for i, m := range ms {
		out[i] = toMember(m)
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

func toRecord(r service.RecordView) api.Record {
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
		out.Attachments[i] = toAttachment(a)
	}
	return out
}

func toRecords(rs []service.RecordView) []api.Record {
	out := make([]api.Record, len(rs))
	for i, r := range rs {
		out[i] = toRecord(r)
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

func toHome(h service.Home) api.Home {
	out := api.Home{InboxCount: h.InboxCount, Members: make([]api.HomeMember, len(h.Members))}
	for i, m := range h.Members {
		hm := api.HomeMember{
			Member: toMember(m.Member), RecentRecords: toRecords(m.RecentRecords),
			EpisodeCountLastYear: m.EpisodeCountLastYear, OpenEpisodes: make([]api.EpisodeSummary, len(m.OpenEpisodes)),
		}
		for j, e := range m.OpenEpisodes {
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

func toPrintData(d service.PrintData) api.PrintData {
	out := api.PrintData{
		Type: api.ReportType(d.Request.Type), GeneratedAt: ts(d.GeneratedAt), Photos: api.PhotoOption(d.Request.Photos),
		Member: toMember(d.Member), Episodes: toEpisodes(d.Episodes), Records: toRecords(d.Records),
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
