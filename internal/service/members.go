package service

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/oapi-codegen/nullable"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/jobs"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
	"github.com/rexingrui/famliy-health/internal/timex"
)

func (s *Service) memberViews(ctx context.Context, q *dbgen.Queries, family uuid.UUID, members []dbgen.Member) ([]MemberView, error) {
	views := make([]MemberView, len(members))
	if len(members) == 0 {
		return views, nil
	}
	ids := make([]uuid.UUID, len(members))
	for i, m := range members {
		ids[i] = m.ID
	}
	refs, err := q.ListLongEpisodeRefs(ctx, dbgen.ListLongEpisodeRefsParams{FamilyID: family, MemberIds: ids})
	if err != nil {
		return nil, err
	}
	byMember := map[uuid.UUID][]dbgen.ListLongEpisodeRefsRow{}
	for _, r := range refs {
		byMember[r.MemberID] = append(byMember[r.MemberID], r)
	}
	for i, m := range members {
		views[i] = MemberView{Member: m, LongEpisodes: byMember[m.ID]}
		if views[i].LongEpisodes == nil {
			views[i].LongEpisodes = []dbgen.ListLongEpisodeRefsRow{}
		}
	}
	return views, nil
}

func (s *Service) memberView(ctx context.Context, q *dbgen.Queries, family uuid.UUID, m dbgen.Member) (MemberView, error) {
	v, err := s.memberViews(ctx, q, family, []dbgen.Member{m})
	if err != nil {
		return MemberView{}, err
	}
	return v[0], nil
}

func (s *Service) ListMembers(ctx context.Context, p auth.Principal, includeArchived bool) ([]MemberView, error) {
	ms, err := s.store.ListMembers(ctx, dbgen.ListMembersParams{FamilyID: p.FamilyID, IncludeArchived: includeArchived})
	if err != nil {
		return nil, err
	}
	return s.memberViews(ctx, s.store.Queries, p.FamilyID, ms)
}

func (s *Service) GetMember(ctx context.Context, p auth.Principal, id uuid.UUID) (MemberView, error) {
	m, err := s.store.GetMember(ctx, dbgen.GetMemberParams{FamilyID: p.FamilyID, ID: id})
	if err != nil {
		return MemberView{}, notFound(err, "成员不存在")
	}
	return s.memberView(ctx, s.store.Queries, p.FamilyID, m)
}

type memberFields struct {
	nickname  string
	relation  dbgen.MemberRelation
	gender    dbgen.MemberGender
	birthDate time.Time
	avatarID  *uuid.UUID
	allergies *string
	notes     *string
	bloodType *dbgen.BloodType
}

func (s *Service) validateMember(ctx context.Context, q *dbgen.Queries, family uuid.UUID, f *memberFields) error {
	var fe errs.Fields
	f.nickname = strings.TrimSpace(f.nickname)
	if n := utf8.RuneCountInString(f.nickname); n == 0 || n > 20 {
		fe.Add("nickname", "invalid", "称呼不能为空，且不超过 20 个字")
	}
	if !f.relation.Valid() {
		fe.Add("relation", "invalid", "关系不正确")
	}
	if !f.gender.Valid() {
		fe.Add("gender", "invalid", "性别不正确")
	}
	if f.bloodType != nil && !f.bloodType.Valid() {
		fe.Add("bloodType", "invalid", "血型不正确")
	}
	bd := timex.DateOf(f.birthDate)
	if bd.After(timex.Today()) || bd.Year() < 1900 {
		fe.Add("birthDate", "out_of_range", "出生日期不正确")
	}
	f.allergies = trimOptional(f.allergies, 500, "allergies", "过敏史不超过 500 个字", &fe)
	f.notes = trimOptional(f.notes, 1000, "notes", "备注不超过 1000 个字", &fe)
	if f.avatarID != nil {
		a, err := q.GetAttachment(ctx, dbgen.GetAttachmentParams{FamilyID: family, ID: *f.avatarID})
		if err != nil || a.Kind != dbgen.AttachmentKindAvatar {
			fe.Add("avatarId", "not_found", "头像不存在，请重新上传")
		}
	}
	return fe.Err()
}

func trimOptional(v *string, maxRunes int, field, msg string, fe *errs.Fields) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil
	}
	if utf8.RuneCountInString(t) > maxRunes {
		fe.Add(field, "too_long", msg)
	}
	return &t
}

func (s *Service) CreateMember(ctx context.Context, p auth.Principal, in api.MemberCreate) (MemberView, error) {
	f := memberFields{
		nickname:  in.Nickname,
		relation:  dbgen.MemberRelation(in.Relation),
		gender:    dbgen.MemberGender(in.Gender),
		birthDate: in.BirthDate.Time,
		avatarID:  in.AvatarId,
		allergies: in.Allergies,
		notes:     in.Notes,
		bloodType: (*dbgen.BloodType)(in.BloodType),
	}
	var view MemberView
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		if err := s.validateMember(ctx, q, p.FamilyID, &f); err != nil {
			return err
		}
		order, err := q.NextMemberSortOrder(ctx, p.FamilyID)
		if err != nil {
			return err
		}
		m, err := q.InsertMember(ctx, dbgen.InsertMemberParams{
			ID: newID(), FamilyID: p.FamilyID, Nickname: f.nickname, Relation: f.relation, Gender: f.gender,
			BirthDate: timex.DateOf(f.birthDate), AvatarID: f.avatarID, Allergies: f.allergies, Notes: f.notes,
			BloodType: f.bloodType, SortOrder: order,
		})
		if err != nil {
			return err
		}
		view, err = s.memberView(ctx, q, p.FamilyID, m)
		return err
	})
	return view, err
}

func (s *Service) UpdateMember(ctx context.Context, p auth.Principal, id uuid.UUID, in api.MemberPatch) (MemberView, error) {
	var view MemberView
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		m, err := q.GetMemberForUpdate(ctx, dbgen.GetMemberForUpdateParams{FamilyID: p.FamilyID, ID: id})
		if err != nil {
			return notFound(err, "成员不存在")
		}
		f := memberFields{
			nickname: m.Nickname, relation: m.Relation, gender: m.Gender, birthDate: m.BirthDate,
			avatarID: m.AvatarID, allergies: m.Allergies, notes: m.Notes, bloodType: m.BloodType,
		}
		if in.Nickname != nil {
			f.nickname = *in.Nickname
		}
		if in.Relation != nil {
			f.relation = dbgen.MemberRelation(*in.Relation)
		}
		if in.Gender != nil {
			f.gender = dbgen.MemberGender(*in.Gender)
		}
		if in.BirthDate != nil {
			f.birthDate = in.BirthDate.Time
		}
		applyNullable(in.AvatarId, &f.avatarID)
		applyNullable(in.Allergies, &f.allergies)
		applyNullable(in.Notes, &f.notes)
		if in.BloodType.IsSpecified() {
			if in.BloodType.IsNull() {
				f.bloodType = nil
			} else {
				bt := dbgen.BloodType(in.BloodType.MustGet())
				f.bloodType = &bt
			}
		}
		order := m.SortOrder
		if in.SortOrder != nil {
			order = int32(*in.SortOrder)
		}
		if err := s.validateMember(ctx, q, p.FamilyID, &f); err != nil {
			return err
		}
		updated, err := q.UpdateMember(ctx, dbgen.UpdateMemberParams{
			FamilyID: p.FamilyID, ID: id, Nickname: f.nickname, Relation: f.relation, Gender: f.gender,
			BirthDate: timex.DateOf(f.birthDate), AvatarID: f.avatarID, Allergies: f.allergies, Notes: f.notes,
			BloodType: f.bloodType, SortOrder: order,
		})
		if err != nil {
			return err
		}
		view, err = s.memberView(ctx, q, p.FamilyID, updated)
		return err
	})
	return view, err
}

func (s *Service) SetMemberArchived(ctx context.Context, p auth.Principal, id uuid.UUID, archived bool) (MemberView, error) {
	var at *time.Time
	if archived {
		now := time.Now()
		at = &now
	}
	m, err := s.store.SetMemberArchived(ctx, dbgen.SetMemberArchivedParams{FamilyID: p.FamilyID, ID: id, ArchivedAt: at})
	if err != nil {
		return MemberView{}, notFound(err, "成员不存在")
	}
	return s.memberView(ctx, s.store.Queries, p.FamilyID, m)
}

// DeleteMember removes the member with all episodes, records and attachments; files are
// removed by a background job enqueued in the same transaction.
func (s *Service) DeleteMember(ctx context.Context, p auth.Principal, id uuid.UUID, confirm bool) error {
	if !confirm {
		return errs.BadRequest("删除成员会同时删除其全部记录，请确认后再操作")
	}
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		if _, err := q.GetMemberForUpdate(ctx, dbgen.GetMemberForUpdateParams{FamilyID: p.FamilyID, ID: id}); err != nil {
			return notFound(err, "成员不存在")
		}
		rows, err := q.ListMemberStorageKeys(ctx, dbgen.ListMemberStorageKeysParams{FamilyID: p.FamilyID, MemberID: id})
		if err != nil {
			return err
		}
		ids := make([]uuid.UUID, 0, len(rows))
		var keys []string
		for _, r := range rows {
			ids = append(ids, r.ID)
			keys = appendKeys(keys, r.OriginalKey, r.StorageKey)
		}
		// The avatar has no record, so it does not cascade; record attachments cascade with records.
		if err := q.DeleteAttachmentsByIDs(ctx, dbgen.DeleteAttachmentsByIDsParams{FamilyID: p.FamilyID, Ids: ids}); err != nil {
			return err
		}
		if _, err := q.DeleteMember(ctx, dbgen.DeleteMemberParams{FamilyID: p.FamilyID, ID: id}); err != nil {
			return err
		}
		if len(keys) > 0 {
			return jobs.Enqueue(ctx, q, jobs.KindDeleteFiles, jobs.DeleteFilesPayload{Keys: keys})
		}
		return nil
	})
	if err == nil {
		s.wakeJobs()
	}
	return err
}

func appendKeys(keys []string, original string, processed *string) []string {
	keys = append(keys, original)
	if processed != nil && *processed != "" && *processed != original {
		keys = append(keys, *processed)
	}
	return keys
}

func applyNullable[T any](n nullable.Nullable[T], dst **T) {
	if !n.IsSpecified() {
		return
	}
	if n.IsNull() {
		*dst = nil
		return
	}
	v := n.MustGet()
	*dst = &v
}

func ptr[T any](v T) *T { return &v }

func applyNullableDate(n nullable.Nullable[openapi_types.Date], dst **time.Time) {
	if !n.IsSpecified() {
		return
	}
	if n.IsNull() {
		*dst = nil
		return
	}
	*dst = ptr(n.MustGet().Time)
}
