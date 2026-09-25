package handler

import (
	"context"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/service"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
)

func (h *Handler) ListRecords(ctx context.Context, req api.ListRecordsRequestObject) (api.ListRecordsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	prm := req.Params
	f := service.RecordFilter{
		MemberID: prm.MemberId, EpisodeID: prm.EpisodeId, Inbox: prm.Inbox != nil && *prm.Inbox,
		Flare: prm.Flare != nil && *prm.Flare, From: prm.From, To: prm.To,
	}
	if prm.Type != nil {
		for _, t := range *prm.Type {
			f.Types = append(f.Types, dbgen.RecordType(t))
		}
	}
	if prm.Q != nil {
		f.Query = *prm.Q
	}
	if prm.Cursor != nil {
		f.Cursor = *prm.Cursor
	}
	if prm.Limit != nil {
		f.Limit = *prm.Limit
	}
	page, err := h.svc.ListRecords(ctx, p, f)
	if err != nil {
		return nil, err
	}
	return api.ListRecords200JSONResponse{Items: h.toRecords(page.Items), NextCursor: page.NextCursor}, nil
}

func (h *Handler) GetRecord(ctx context.Context, req api.GetRecordRequestObject) (api.GetRecordResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	r, err := h.svc.GetRecord(ctx, p, req.Id)
	if err != nil {
		return nil, err
	}
	return api.GetRecord200JSONResponse(h.toRecord(r)), nil
}

func (h *Handler) PutRecord(ctx context.Context, req api.PutRecordRequestObject) (api.PutRecordResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	r, created, err := h.svc.PutRecord(ctx, p, req.Id, *req.Body)
	if err != nil {
		return nil, err
	}
	if created {
		return api.PutRecord201JSONResponse(h.toRecord(r)), nil
	}
	return api.PutRecord200JSONResponse(h.toRecord(r)), nil
}

func (h *Handler) UpdateRecord(ctx context.Context, req api.UpdateRecordRequestObject) (api.UpdateRecordResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	r, err := h.svc.UpdateRecord(ctx, p, req.Id, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.UpdateRecord200JSONResponse(h.toRecord(r)), nil
}

func (h *Handler) DeleteRecord(ctx context.Context, req api.DeleteRecordRequestObject) (api.DeleteRecordResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.DeleteRecord(ctx, p, req.Id); err != nil {
		return nil, err
	}
	return api.DeleteRecord204Response{}, nil
}

func (h *Handler) AssignRecords(ctx context.Context, req api.AssignRecordsRequestObject) (api.AssignRecordsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	res, err := h.svc.AssignRecords(ctx, p, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.AssignRecords200JSONResponse{EpisodeId: res.EpisodeID, Updated: int(res.Updated)}, nil
}

func (h *Handler) GetLastMedication(ctx context.Context, req api.GetLastMedicationRequestObject) (api.GetLastMedicationResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	last, err := h.svc.LastMedication(ctx, p, req.Params.MemberId, req.Params.MedName)
	if err != nil {
		return nil, err
	}
	out := api.LastMedication{}
	if last != nil {
		d := toMedicationDose(last.Record, last.HoursSince)
		out.Last = &d
	}
	return api.GetLastMedication200JSONResponse(out), nil
}
