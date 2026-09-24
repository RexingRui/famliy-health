package handler

import (
	"context"
	"net/url"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/service"
)

func (h *Handler) CreateExport(ctx context.Context, req api.CreateExportRequestObject) (api.CreateExportResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	b := req.Body
	if b == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	r := service.ReportRequest{Type: string(b.Type), Photos: string(b.Photos)}
	switch b.Type {
	case api.ReportTypeEpisode:
		if b.EpisodeId == nil {
			return nil, errs.Validation("请选择病程", map[string]string{"episodeId": "required"})
		}
		r.ID = *b.EpisodeId
	case api.ReportTypeMember:
		if b.MemberId == nil {
			return nil, errs.Validation("请选择成员", map[string]string{"memberId": "required"})
		}
		r.ID = *b.MemberId
	}
	if b.From != nil {
		r.From = &b.From.Time
	}
	if b.To != nil {
		r.To = &b.To.Time
	}
	pdf, name, err := h.svc.Export(ctx, p, r)
	if err != nil {
		return nil, err
	}
	disposition := `attachment; filename="report.pdf"; filename*=UTF-8''` + url.PathEscape(name)
	return api.CreateExport200ApplicationpdfResponse{
		Body:    pdf,
		Headers: api.CreateExport200ResponseHeaders{ContentDisposition: &disposition},
	}, nil
}

func (h *Handler) GetPrintData(ctx context.Context, req api.GetPrintDataRequestObject) (api.GetPrintDataResponseObject, error) {
	prm := req.Params
	if prm.Token != nil && *prm.Token != "" {
		d, err := h.svc.PrintDataByToken(ctx, *prm.Token)
		if err != nil {
			return nil, err
		}
		return api.GetPrintData200JSONResponse(toPrintData(d)), nil
	}
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	r := service.ReportRequest{ID: derefUUID(prm.Id)}
	if prm.Type != nil {
		r.Type = string(*prm.Type)
	}
	if prm.Photos != nil {
		r.Photos = string(*prm.Photos)
	}
	r.From = dateParam(prm.From)
	r.To = dateParam(prm.To)
	d, err := h.svc.PrintData(ctx, p, r)
	if err != nil {
		return nil, err
	}
	return api.GetPrintData200JSONResponse(toPrintData(d)), nil
}

func derefUUID(id *uuid.UUID) uuid.UUID {
	if id == nil {
		return uuid.Nil
	}
	return *id
}

func dateParam(d *openapi_types.Date) *time.Time {
	if d == nil {
		return nil
	}
	return &d.Time
}
