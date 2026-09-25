package handler

import (
	"context"
	"net/http"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/httpctx"
	"github.com/rexingrui/famliy-health/internal/service"
)

func (h *Handler) UploadAttachment(ctx context.Context, req api.UploadAttachmentRequestObject) (api.UploadAttachmentResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请用 multipart/form-data 上传")
	}
	a, created, err := h.svc.UploadAttachment(ctx, p, req.Id, req.Body)
	if err != nil {
		return nil, err
	}
	if created {
		return api.UploadAttachment201JSONResponse(h.toAttachment(a)), nil
	}
	return api.UploadAttachment200JSONResponse(h.toAttachment(a)), nil
}

func (h *Handler) UpdateAttachment(ctx context.Context, req api.UpdateAttachmentRequestObject) (api.UpdateAttachmentResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, errs.BadRequest("请求内容为空")
	}
	a, err := h.svc.UpdateAttachment(ctx, p, req.Id, *req.Body)
	if err != nil {
		return nil, err
	}
	return api.UpdateAttachment200JSONResponse(h.toAttachment(a)), nil
}

func (h *Handler) DeleteAttachment(ctx context.Context, req api.DeleteAttachmentRequestObject) (api.DeleteAttachmentResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.DeleteAttachment(ctx, p, req.Id); err != nil {
		return nil, err
	}
	return api.DeleteAttachment204Response{}, nil
}

func (h *Handler) ReprocessAttachment(ctx context.Context, req api.ReprocessAttachmentRequestObject) (api.ReprocessAttachmentResponseObject, error) {
	p, err := principal(ctx)
	if err != nil {
		return nil, err
	}
	a, err := h.svc.ReprocessAttachment(ctx, p, req.Id)
	if err != nil {
		return nil, err
	}
	return api.ReprocessAttachment200JSONResponse(h.toAttachment(a)), nil
}

// fileResponse streams through http.ServeContent so Range requests (audio seeking) work.
type fileResponse struct {
	r *http.Request
	f service.OpenedFile
}

func (fr fileResponse) VisitGetAttachmentFileResponse(w http.ResponseWriter) error {
	defer fr.f.Close()
	w.Header().Set("Content-Type", fr.f.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, fr.r, fr.f.Name, fr.f.ModTime, fr.f)
	return nil
}

func (h *Handler) GetAttachmentFile(ctx context.Context, req api.GetAttachmentFileRequestObject) (api.GetAttachmentFileResponseObject, error) {
	var access service.FileAccess
	if p, ok := auth.FromContext(ctx); ok {
		access.Principal = &p
	} else if req.Params.Token != nil {
		c, err := h.svc.VerifyPrintToken(*req.Params.Token)
		if err != nil {
			return nil, err
		}
		access.TokenFamily, access.TokenMember = &c.Family, &c.Member
	}
	variant := "default"
	if req.Params.Variant != nil {
		variant = string(*req.Params.Variant)
	}
	f, err := h.svc.OpenAttachmentFile(ctx, req.Id, variant, access)
	if err != nil {
		return nil, err
	}
	return fileResponse{r: httpctx.Request(ctx), f: f}, nil
}
