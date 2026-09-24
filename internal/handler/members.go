package handler

import (
	"context"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/errs"
)

func (h *Handler) GetHome(ctx context.Context, _ api.GetHomeRequestObject) (api.GetHomeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	home, err := h.svc.Home(ctx, p)
	if err != nil {
		return nil, err
	}
	return api.GetHome200JSONResponse(toHome(home)), nil
}

func (h *Handler) ListMembers(ctx context.Context, req api.ListMembersRequestObject) (api.ListMembersResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	ms, err := h.svc.ListMembers(ctx, p, req.Params.IncludeArchived != nil && *req.Params.IncludeArchived)
	if err != nil {
		return nil, err
	}
	return api.ListMembers200JSONResponse(toMembers(ms)), nil
}

func (h *Handler) CreateMember(ctx context.Context, req api.CreateMemberRequestObject) (api.CreateMemberResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	m, err := h.svc.CreateMember(ctx, p, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.CreateMember201JSONResponse(toMember(m)), nil
}

func (h *Handler) GetMember(ctx context.Context, req api.GetMemberRequestObject) (api.GetMemberResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	m, err := h.svc.GetMember(ctx, p, req.Id)
	if err != nil {
		return nil, err
	}
	return api.GetMember200JSONResponse(toMember(m)), nil
}

func (h *Handler) UpdateMember(ctx context.Context, req api.UpdateMemberRequestObject) (api.UpdateMemberResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	m, err := h.svc.UpdateMember(ctx, p, req.Id, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.UpdateMember200JSONResponse(toMember(m)), nil
}

func (h *Handler) DeleteMember(ctx context.Context, req api.DeleteMemberRequestObject) (api.DeleteMemberResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.DeleteMember(ctx, p, req.Id, req.Params.Confirm); err != nil {
		return nil, err
	}
	return api.DeleteMember204Response{}, nil
}

func (h *Handler) ArchiveMember(ctx context.Context, req api.ArchiveMemberRequestObject) (api.ArchiveMemberResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	m, err := h.svc.SetMemberArchived(ctx, p, req.Id, true)
	if err != nil {
		return nil, err
	}
	return api.ArchiveMember200JSONResponse(toMember(m)), nil
}

func (h *Handler) UnarchiveMember(ctx context.Context, req api.UnarchiveMemberRequestObject) (api.UnarchiveMemberResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	m, err := h.svc.SetMemberArchived(ctx, p, req.Id, false)
	if err != nil {
		return nil, err
	}
	return api.UnarchiveMember200JSONResponse(toMember(m)), nil
}

func (h *Handler) GetMemberByDisease(ctx context.Context, req api.GetMemberByDiseaseRequestObject) (api.GetMemberByDiseaseResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	rng := "1y"
	if req.Params.Range != nil {
		rng = string(*req.Params.Range)
	}
	ds, err := h.svc.ByDisease(ctx, p, req.Id, rng)
	if err != nil {
		return nil, err
	}
	return api.GetMemberByDisease200JSONResponse(toByDisease(rng, ds)), nil
}

func (h *Handler) GetMemberCalendar(ctx context.Context, req api.GetMemberCalendarRequestObject) (api.GetMemberCalendarResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	c, err := h.svc.MemberCalendar(ctx, p, req.Id, req.Params.Month)
	if err != nil {
		return nil, err
	}
	return api.GetMemberCalendar200JSONResponse(toCalendar(c)), nil
}
