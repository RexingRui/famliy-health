package service

import (
	"context"
	"encoding/base64"
	"errors"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/jobs"
	"github.com/rexingrui/famliy-health/internal/store"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
	"github.com/rexingrui/famliy-health/internal/timex"
)

// recordFields is the mutable content of a record, validated as a whole.
type recordFields struct {
	memberID    uuid.UUID
	episodeID   *uuid.UUID
	typ         *dbgen.RecordType
	occurredAt  time.Time
	body        string
	isFlare     bool
	severity    *int16
	temperature *float64
	medName     *string
	medDose     *float64
	medUnit     *string
	costCents   *int32
	details     RecordDetails
}

func fieldsFromRecord(r dbgen.Record) recordFields {
	return recordFields{
		memberID: r.MemberID, episodeID: r.EpisodeID, typ: r.Type, occurredAt: r.OccurredAt, body: r.Body,
		isFlare: r.IsFlare, severity: r.Severity, temperature: r.Temperature, medName: r.MedName,
		medDose: r.MedDose, medUnit: r.MedUnit, costCents: r.CostCents, details: decodeDetails(r.Details),
	}
}

var typeLabel = map[dbgen.RecordType]string{
	dbgen.RecordTypeSymptom: "症状", dbgen.RecordTypeTemperature: "体温", dbgen.RecordTypeMedication: "用药",
	dbgen.RecordTypeVisit: "就诊", dbgen.RecordTypeTreatment: "治疗康复", dbgen.RecordTypeExam: "检查",
	dbgen.RecordTypeOther: "其他",
}

// allowedFields lists the type-specific fields each record type may carry.
func allowedFields(t *dbgen.RecordType) map[string]bool {
	if t == nil {
		return map[string]bool{}
	}
	switch *t {
	case dbgen.RecordTypeSymptom:
		return map[string]bool{"severity": true}
	case dbgen.RecordTypeTemperature:
		return map[string]bool{"temperature": true}
	case dbgen.RecordTypeMedication:
		return map[string]bool{"medName": true, "medDose": true, "medUnit": true}
	case dbgen.RecordTypeVisit:
		return map[string]bool{"costCents": true, "details.hospital": true, "details.department": true, "details.doctor": true}
	case dbgen.RecordTypeTreatment:
		return map[string]bool{"costCents": true, "details.item": true, "details.institution": true}
	case dbgen.RecordTypeExam:
		return map[string]bool{"details.item": true}
	}
	return map[string]bool{}
}

func (f *recordFields) present() map[string]bool {
	d := f.details
	return map[string]bool{
		"severity": f.severity != nil, "temperature": f.temperature != nil, "medName": f.medName != nil,
		"medDose": f.medDose != nil, "medUnit": f.medUnit != nil, "costCents": f.costCents != nil,
		"details.hospital": d.Hospital != "", "details.department": d.Department != "", "details.doctor": d.Doctor != "",
		"details.item": d.Item != "", "details.institution": d.Institution != "",
	}
}

// clearForType drops type-specific values the (new) type does not use.
func (f *recordFields) clearForType() {
	allowed := allowedFields(f.typ)
	if !allowed["severity"] {
		f.severity = nil
	}
	if !allowed["temperature"] {
		f.temperature = nil
	}
	if !allowed["medName"] {
		f.medName, f.medDose, f.medUnit = nil, nil, nil
	}
	if !allowed["costCents"] {
		f.costCents = nil
	}
	d := &f.details
	if !allowed["details.hospital"] {
		d.Hospital, d.Department, d.Doctor = "", "", ""
	}
	if !allowed["details.item"] {
		d.Item = ""
	}
	if !allowed["details.institution"] {
		d.Institution = ""
	}
}

const maxFutureSkew = 10 * time.Minute

// validate checks ranges and the type↔field correspondence. episodeKind is the kind of the
// target episode, or nil when the record is in the inbox.
func (f *recordFields) validate(episodeKind *dbgen.EpisodeKind) error {
	var fe errs.Fields
	if f.typ != nil && !f.typ.Valid() {
		fe.Add("type", "invalid", "记录类型不正确")
	}
	f.body = strings.TrimSpace(f.body)
	if utf8.RuneCountInString(f.body) > 5000 {
		fe.Add("body", "too_long", "文字不超过 5000 个字")
	}
	if f.occurredAt.IsZero() {
		fe.Add("occurredAt", "required", "请填写发生时间")
	} else if f.occurredAt.After(time.Now().Add(maxFutureSkew)) {
		fe.Add("occurredAt", "in_future", "发生时间不能晚于现在")
	}
	if f.medName != nil {
		if n := strings.TrimSpace(*f.medName); n == "" {
			f.medName = nil
		} else {
			f.medName = &n
		}
	}
	f.details = f.details.trimmed()

	allowed := allowedFields(f.typ)
	for field, set := range f.present() {
		if set && !allowed[field] {
			label := "未选类型"
			if f.typ != nil {
				label = "“" + typeLabel[*f.typ] + "”"
			}
			fe.Add(field, "not_allowed_for_type", label+"的记录不能填写这个字段")
		}
	}
	if f.severity != nil && (*f.severity < 0 || *f.severity > 10) {
		fe.Add("severity", "out_of_range", "症状程度需在 0 到 10 之间")
	}
	if f.temperature != nil {
		t := math.Round(*f.temperature*10) / 10
		f.temperature = &t
		if t < 34 || t > 43 {
			fe.Add("temperature", "out_of_range", "体温需在 34.0 到 43.0 之间")
		}
	}
	if f.medName != nil && utf8.RuneCountInString(*f.medName) > 100 {
		fe.Add("medName", "too_long", "药名不超过 100 个字")
	}
	if f.medDose != nil && (*f.medDose <= 0 || *f.medDose >= 10000) {
		fe.Add("medDose", "out_of_range", "剂量需大于 0")
	}
	if f.medUnit != nil && !validMedUnit(*f.medUnit) {
		fe.Add("medUnit", "invalid", "单位只能是 ml、片、粒、袋")
	}
	if f.costCents != nil && (*f.costCents < 0 || *f.costCents > 100_000_000) {
		fe.Add("costCents", "out_of_range", "费用不正确")
	}
	for _, v := range []string{f.details.Hospital, f.details.Item, f.details.Institution} {
		if utf8.RuneCountInString(v) > 100 {
			fe.Add("details", "too_long", "详细信息每项不超过 100 个字")
		}
	}
	if f.isFlare && (episodeKind == nil || *episodeKind != dbgen.EpisodeKindLong) {
		fe.Add("isFlare", "requires_long_episode", "只有长期病程中的记录可以标记“发作”")
	}
	return fe.Err()
}

func validMedUnit(u string) bool {
	switch api.MedUnit(u) {
	case api.MedUnitMl, api.MedUnitTablet, api.MedUnitCapsule, api.MedUnitSachet:
		return true
	}
	return false
}

// searchText is what the “搜索” box matches: text, audio captions, medicine and hospital names.
func searchText(f recordFields, captions []string) string {
	parts := []string{f.body}
	parts = append(parts, captions...)
	if f.medName != nil {
		parts = append(parts, *f.medName)
	}
	parts = append(parts, f.details.Hospital, f.details.Department, f.details.Item, f.details.Institution)
	var b strings.Builder
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			if b.Len() > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(p)
		}
	}
	return b.String()
}

// checkEpisode loads the target episode and checks it belongs to the record's member.
func checkEpisode(ctx context.Context, q *dbgen.Queries, family, memberID uuid.UUID, episodeID *uuid.UUID) (*dbgen.EpisodeKind, error) {
	if episodeID == nil {
		return nil, nil
	}
	e, err := q.GetEpisodeForUpdate(ctx, dbgen.GetEpisodeForUpdateParams{FamilyID: family, ID: *episodeID})
	if store.IsNotFound(err) {
		return nil, errs.Validation("病程不存在", map[string]string{"episodeId": "not_found"})
	}
	if err != nil {
		return nil, err
	}
	if e.MemberID != memberID {
		return nil, errs.Validation("病程不属于这个成员", map[string]string{"episodeId": "member_mismatch"})
	}
	return &e.Kind, nil
}

func checkMember(ctx context.Context, q *dbgen.Queries, family, memberID uuid.UUID) error {
	_, err := q.GetMember(ctx, dbgen.GetMemberParams{FamilyID: family, ID: memberID})
	if store.IsNotFound(err) {
		return errs.Validation("成员不存在", map[string]string{"memberId": "not_found"})
	}
	return err
}

func (s *Service) GetRecord(ctx context.Context, p auth.Principal, id uuid.UUID) (RecordView, error) {
	r, err := s.store.GetRecord(ctx, dbgen.GetRecordParams{FamilyID: p.FamilyID, ID: id})
	if err != nil {
		return RecordView{}, notFound(err, "记录不存在")
	}
	return s.recordView(ctx, s.store.Queries, p.FamilyID, r)
}

// PutRecord creates a record with a client-generated ID. Resubmitting the same ID (weak-network
// retries) returns the stored record unchanged with created=false.
func (s *Service) PutRecord(ctx context.Context, p auth.Principal, id uuid.UUID, in api.RecordCreate) (RecordView, bool, error) {
	f := recordFields{
		memberID: in.MemberId, episodeID: in.EpisodeId, occurredAt: in.OccurredAt,
		medName: in.MedName, medDose: in.MedDose, costCents: int32Ptr(in.CostCents),
	}
	if in.Type != nil {
		f.typ = ptr(dbgen.RecordType(*in.Type))
	}
	if in.Body != nil {
		f.body = *in.Body
	}
	if in.IsFlare != nil {
		f.isFlare = *in.IsFlare
	}
	if in.Severity != nil {
		f.severity = ptr(int16(*in.Severity))
	}
	if in.Temperature != nil {
		f.temperature = in.Temperature
	}
	if in.MedUnit != nil {
		f.medUnit = ptr(string(*in.MedUnit))
	}
	if in.Details != nil {
		f.details = detailsFromAPI(*in.Details)
	}

	var rec dbgen.Record
	created := false
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		if fam, err := q.GetRecordFamily(ctx, id); err == nil {
			if fam != p.FamilyID {
				return errs.Conflict("记录 ID 冲突，请重试")
			}
			rec, err = q.GetRecord(ctx, dbgen.GetRecordParams{FamilyID: p.FamilyID, ID: id})
			return err
		} else if !store.IsNotFound(err) {
			return err
		}
		if err := checkMember(ctx, q, p.FamilyID, f.memberID); err != nil {
			return err
		}
		if in.NewEpisode != nil {
			if in.EpisodeId != nil {
				return errs.Validation("episodeId 和 newEpisode 只能二选一", map[string]string{"newEpisode": "conflict"})
			}
			e, err := s.createNewEpisode(ctx, q, p, f.memberID, *in.NewEpisode)
			if err != nil {
				return err
			}
			f.episodeID = &e.ID
		}
		kind, err := checkEpisode(ctx, q, p.FamilyID, f.memberID, f.episodeID)
		if err != nil {
			return err
		}
		if err := f.validate(kind); err != nil {
			return err
		}
		rec, err = q.InsertRecord(ctx, dbgen.InsertRecordParams{
			ID: id, FamilyID: p.FamilyID, MemberID: f.memberID, EpisodeID: f.episodeID, Type: f.typ,
			OccurredAt: f.occurredAt, Body: f.body, IsFlare: f.isFlare, Severity: f.severity,
			Temperature: f.temperature, MedName: f.medName, MedDose: f.medDose, MedUnit: f.medUnit,
			CostCents: f.costCents, Details: encodeDetails(f.details), SearchText: searchText(f, nil),
			CreatedBy: &p.AccountID,
		})
		if store.IsNotFound(err) {
			// A concurrent retry inserted the same ID first; roll back (including any new episode).
			return errSentinelRollback
		}
		created = err == nil
		return err
	})
	if errors.Is(err, errSentinelRollback) {
		rec, err = s.store.GetRecord(ctx, dbgen.GetRecordParams{FamilyID: p.FamilyID, ID: id})
	}
	if err != nil {
		return RecordView{}, false, err
	}
	view, err := s.recordView(ctx, s.store.Queries, p.FamilyID, rec)
	return view, created, err
}

func (s *Service) UpdateRecord(ctx context.Context, p auth.Principal, id uuid.UUID, in api.RecordPatch) (RecordView, error) {
	var view RecordView
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		r, err := q.GetRecordForUpdate(ctx, dbgen.GetRecordForUpdateParams{FamilyID: p.FamilyID, ID: id})
		if err != nil {
			return notFound(err, "记录不存在")
		}
		f := fieldsFromRecord(r)
		if in.MemberId != nil && *in.MemberId != f.memberID {
			if err := checkMember(ctx, q, p.FamilyID, *in.MemberId); err != nil {
				return err
			}
			f.memberID = *in.MemberId
		}
		applyNullable(in.EpisodeId, &f.episodeID)
		if in.Type.IsSpecified() {
			if in.Type.IsNull() {
				f.typ = nil
			} else {
				f.typ = ptr(dbgen.RecordType(in.Type.MustGet()))
			}
			// Values belonging to the old type are dropped unless this request re-sends them.
			if !sameType(f.typ, r.Type) {
				f.clearForType()
			}
		}
		if in.OccurredAt != nil {
			f.occurredAt = *in.OccurredAt
		}
		if in.Body != nil {
			f.body = *in.Body
		}
		if in.IsFlare != nil {
			f.isFlare = *in.IsFlare
		}
		if in.Severity.IsSpecified() {
			if in.Severity.IsNull() {
				f.severity = nil
			} else {
				f.severity = ptr(int16(clampInt(in.Severity.MustGet(), -1, 11)))
			}
		}
		applyNullable(in.Temperature, &f.temperature)
		applyNullable(in.MedName, &f.medName)
		applyNullable(in.MedDose, &f.medDose)
		if in.MedUnit.IsSpecified() {
			if in.MedUnit.IsNull() {
				f.medUnit = nil
			} else {
				f.medUnit = ptr(string(in.MedUnit.MustGet()))
			}
		}
		if in.CostCents.IsSpecified() {
			if in.CostCents.IsNull() {
				f.costCents = nil
			} else {
				f.costCents = ptr(int32(clampInt(in.CostCents.MustGet(), -1, math.MaxInt32)))
			}
		}
		if in.Details != nil {
			f.details = detailsFromAPI(*in.Details)
		}

		kind, err := checkEpisode(ctx, q, p.FamilyID, f.memberID, f.episodeID)
		if err != nil {
			return err
		}
		if kind == nil || *kind != dbgen.EpisodeKindLong {
			if in.IsFlare == nil {
				f.isFlare = false // moved out of a long episode
			}
		}
		if err := f.validate(kind); err != nil {
			return err
		}
		captions, err := q.ListCaptionsByRecord(ctx, &id)
		if err != nil {
			return err
		}
		updated, err := q.UpdateRecord(ctx, dbgen.UpdateRecordParams{
			FamilyID: p.FamilyID, ID: id, MemberID: f.memberID, EpisodeID: f.episodeID, Type: f.typ,
			OccurredAt: f.occurredAt, Body: f.body, IsFlare: f.isFlare, Severity: f.severity,
			Temperature: f.temperature, MedName: f.medName, MedDose: f.medDose, MedUnit: f.medUnit,
			CostCents: f.costCents, Details: encodeDetails(f.details), SearchText: searchText(f, derefAll(captions)),
		})
		if err != nil {
			return err
		}
		view, err = s.recordView(ctx, q, p.FamilyID, updated)
		return err
	})
	return view, err
}

func (s *Service) DeleteRecord(ctx context.Context, p auth.Principal, id uuid.UUID) error {
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		rows, err := q.ListRecordStorageKeys(ctx, dbgen.ListRecordStorageKeysParams{FamilyID: p.FamilyID, RecordID: &id})
		if err != nil {
			return err
		}
		n, err := q.DeleteRecord(ctx, dbgen.DeleteRecordParams{FamilyID: p.FamilyID, ID: id})
		if err != nil {
			return err
		}
		if n == 0 {
			return errs.NotFound("记录不存在")
		}
		var keys []string
		for _, r := range rows {
			keys = appendKeys(keys, r.OriginalKey, r.StorageKey)
		}
		if len(keys) == 0 {
			return nil
		}
		return jobs.Enqueue(ctx, q, jobs.KindDeleteFiles, jobs.DeleteFilesPayload{Keys: keys})
	})
	if err == nil {
		s.wakeJobs()
	}
	return err
}

// ---------- Listing ----------

type RecordFilter struct {
	MemberID  *uuid.UUID
	EpisodeID *uuid.UUID
	Inbox     bool
	Types     []dbgen.RecordType
	Flare     bool
	From, To  *time.Time
	Query     string
	Cursor    string
	Limit     int
}

type RecordPage struct {
	Items      []RecordView
	NextCursor *string
}

func encodeCursor(r dbgen.Record) string {
	return base64.RawURLEncoding.EncodeToString([]byte(r.OccurredAt.UTC().Format(time.RFC3339Nano) + "|" + r.ID.String()))
}

func decodeCursor(c string) (time.Time, uuid.UUID, error) {
	b, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	ts, idStr, ok := strings.Cut(string(b), "|")
	if !ok {
		return time.Time{}, uuid.Nil, errors.New("bad cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	id, err := uuid.Parse(idStr)
	return t, id, err
}

// likePattern escapes LIKE metacharacters so the query is matched literally.
func likePattern(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

func (s *Service) ListRecords(ctx context.Context, p auth.Principal, f RecordFilter) (RecordPage, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	limit = min(limit, 200)
	params := dbgen.ListRecordsParams{
		FamilyID: p.FamilyID, MemberID: f.MemberID, EpisodeID: f.EpisodeID, InboxOnly: f.Inbox,
		Types: []string{}, FlareOnly: f.Flare, FromTime: f.From, ToTime: f.To, Lim: int32(limit + 1),
	}
	for _, t := range f.Types {
		params.Types = append(params.Types, string(t))
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		params.Pattern = ptr(likePattern(q))
	}
	if f.Cursor != "" {
		t, id, err := decodeCursor(f.Cursor)
		if err != nil {
			return RecordPage{}, errs.BadRequest("分页参数不正确")
		}
		params.CursorTime, params.CursorID = &t, &id
	}
	rows, err := s.store.ListRecords(ctx, params)
	if err != nil {
		return RecordPage{}, err
	}
	page := RecordPage{}
	if len(rows) > limit {
		rows = rows[:limit]
		page.NextCursor = ptr(encodeCursor(rows[limit-1]))
	}
	page.Items, err = s.recordViews(ctx, s.store.Queries, p.FamilyID, rows)
	return page, err
}

// ---------- Batch assignment ----------

type AssignResult struct {
	EpisodeID *uuid.UUID
	Updated   int64
}

// AssignRecords moves records (all of one member) into an episode, a new episode, or back to
// the inbox, in one transaction.
func (s *Service) AssignRecords(ctx context.Context, p auth.Principal, in api.AssignRequest) (AssignResult, error) {
	ids := uniqueIDs(in.Ids)
	if len(ids) == 0 || len(ids) > 200 {
		return AssignResult{}, errs.Validation("请选择 1 到 200 条记录", map[string]string{"ids": "invalid"})
	}
	var res AssignResult
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		recs, err := q.ListRecordsByIDsForUpdate(ctx, dbgen.ListRecordsByIDsForUpdateParams{FamilyID: p.FamilyID, Ids: ids})
		if err != nil {
			return err
		}
		if len(recs) != len(ids) {
			return errs.NotFound("部分记录不存在，请刷新后重试")
		}
		member := recs[0].MemberID
		for _, r := range recs[1:] {
			if r.MemberID != member {
				return errs.Validation("只能把同一成员的记录一起归入病程", map[string]string{"ids": "member_mismatch"})
			}
		}
		target := in.EpisodeId
		if in.NewEpisode != nil {
			e, err := s.createNewEpisode(ctx, q, p, member, *in.NewEpisode)
			if err != nil {
				return err
			}
			target = &e.ID
		}
		kind, err := checkEpisode(ctx, q, p.FamilyID, member, target)
		if err != nil {
			return err
		}
		keepFlare := kind != nil && *kind == dbgen.EpisodeKindLong
		n, err := q.AssignRecords(ctx, dbgen.AssignRecordsParams{FamilyID: p.FamilyID, Ids: ids, EpisodeID: target, KeepFlare: keepFlare})
		res = AssignResult{EpisodeID: target, Updated: n}
		return err
	})
	return res, err
}

// ---------- Medication hint ----------

type LastMedication struct {
	Record     dbgen.Record
	HoursSince float64
}

func (s *Service) LastMedication(ctx context.Context, p auth.Principal, memberID uuid.UUID, medName string) (*LastMedication, error) {
	r, err := s.store.LastMedication(ctx, dbgen.LastMedicationParams{FamilyID: p.FamilyID, MemberID: memberID, MedName: ptr(strings.TrimSpace(medName))})
	if store.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	h := math.Round(timex.Now().Sub(r.OccurredAt).Hours()*10) / 10
	return &LastMedication{Record: r, HoursSince: h}, nil
}

// ---------- helpers ----------

func detailsFromAPI(d api.RecordDetails) RecordDetails {
	return RecordDetails{
		Hospital: deref(d.Hospital), Department: deref(d.Department), Doctor: deref(d.Doctor),
		Item: deref(d.Item), Institution: deref(d.Institution),
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefAll(ss []*string) []string {
	out := make([]string, 0, len(ss))
	for _, s := range ss {
		if s != nil {
			out = append(out, *s)
		}
	}
	return out
}

func int32Ptr(v *int) *int32 {
	if v == nil {
		return nil
	}
	return ptr(int32(clampInt(*v, -1, math.MaxInt32)))
}

// clampInt keeps out-of-range input representable so validation can report it.
func clampInt(v, lo, hi int) int {
	return max(lo, min(hi, v))
}

func sameType(a, b *dbgen.RecordType) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func uniqueIDs(ids []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
