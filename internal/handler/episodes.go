package handler

import (
	"context"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/service"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
)

func (h *Handler) ListDiseaseTags(ctx context.Context, _ api.ListDiseaseTagsRequestObject) (api.ListDiseaseTagsResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	tags, err := h.svc.ListDiseaseTags(ctx, p)
	if err != nil {
		return nil, err
	}
	out := make(api.ListDiseaseTags200JSONResponse, len(tags))
	for i, t := range tags {
		out[i] = api.DiseaseTag{Id: t.ID, Name: t.Name}
	}
	return out, nil
}

func (h *Handler) CreateDiseaseTag(ctx context.Context, req api.CreateDiseaseTagRequestObject) (api.CreateDiseaseTagResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	t, created, err := h.svc.EnsureDiseaseTag(ctx, p, req.Body.Name)
	if err != nil {
		return nil, err
	}
	tag := api.DiseaseTag{Id: t.ID, Name: t.Name}
	if created {
		return api.CreateDiseaseTag201JSONResponse(tag), nil
	}
	return api.CreateDiseaseTag200JSONResponse(tag), nil
}

func (h *Handler) ListEpisodes(ctx context.Context, req api.ListEpisodesRequestObject) (api.ListEpisodesResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	f := service.EpisodeFilter{MemberID: req.Params.MemberId, DiseaseTagID: req.Params.DiseaseTagId, Open: req.Params.Open}
	if req.Params.Kind != nil {
		k := dbgen.EpisodeKind(*req.Params.Kind)
		f.Kind = &k
	}
	es, err := h.svc.ListEpisodes(ctx, p, f)
	if err != nil {
		return nil, err
	}
	return api.ListEpisodes200JSONResponse(toEpisodes(es)), nil
}

func (h *Handler) CreateEpisode(ctx context.Context, req api.CreateEpisodeRequestObject) (api.CreateEpisodeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	e, err := h.svc.CreateEpisode(ctx, p, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.CreateEpisode201JSONResponse(toEpisode(e)), nil
}

func (h *Handler) GetEpisode(ctx context.Context, req api.GetEpisodeRequestObject) (api.GetEpisodeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	e, err := h.svc.GetEpisode(ctx, p, req.Id)
	if err != nil {
		return nil, err
	}
	return api.GetEpisode200JSONResponse(toEpisode(e)), nil
}

func (h *Handler) UpdateEpisode(ctx context.Context, req api.UpdateEpisodeRequestObject) (api.UpdateEpisodeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	e, err := h.svc.UpdateEpisode(ctx, p, req.Id, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.UpdateEpisode200JSONResponse(toEpisode(e)), nil
}

func (h *Handler) DeleteEpisode(ctx context.Context, req api.DeleteEpisodeRequestObject) (api.DeleteEpisodeResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.DeleteEpisode(ctx, p, req.Id); err != nil {
		return nil, err
	}
	return api.DeleteEpisode204Response{}, nil
}

func (h *Handler) GetEpisodeCalendar(ctx context.Context, req api.GetEpisodeCalendarRequestObject) (api.GetEpisodeCalendarResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	c, err := h.svc.EpisodeCalendar(ctx, p, req.Id, req.Params.Month)
	if err != nil {
		return nil, err
	}
	return api.GetEpisodeCalendar200JSONResponse(toCalendar(c)), nil
}

func (h *Handler) GetEpisodeTrend(ctx context.Context, req api.GetEpisodeTrendRequestObject) (api.GetEpisodeTrendResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	t, err := h.svc.EpisodeTrend(ctx, p, req.Id, req.Params.From, req.Params.To)
	if err != nil {
		return nil, err
	}
	return api.GetEpisodeTrend200JSONResponse(api.Trend{Temperature: toTrendPoints(t.Temperature), Severity: toTrendPoints(t.Severity)}), nil
}
