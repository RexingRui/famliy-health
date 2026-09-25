package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/api"
	"github.com/rexingrui/famliy-health/internal/auth"
	"github.com/rexingrui/famliy-health/internal/errs"
	"github.com/rexingrui/famliy-health/internal/jobs"
	"github.com/rexingrui/famliy-health/internal/media"
	"github.com/rexingrui/famliy-health/internal/storage"
	"github.com/rexingrui/famliy-health/internal/store"
	"github.com/rexingrui/famliy-health/internal/store/dbgen"
)

const (
	maxPhotoBytes   = 10 << 20
	maxAudioBytes   = 20 << 20
	maxAvatarBytes  = 2 << 20
	maxAudioMs      = 180_000
	maxPhotosPerRec = 9
	thumbMaxSide    = 400
)

type format struct {
	mime, ext string
}

var (
	formatJPEG = format{"image/jpeg", "jpg"}
	formatMP4  = format{"audio/mp4", "mp4"}
	formatWebM = format{"audio/webm", "webm"}
	formatOgg  = format{"audio/ogg", "ogg"}
)

// sniff identifies the upload by magic bytes instead of trusting the declared type.
func sniff(head []byte) (format, bool) {
	switch {
	case len(head) >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF:
		return formatJPEG, true
	case len(head) >= 8 && string(head[4:8]) == "ftyp":
		return formatMP4, true
	case len(head) >= 4 && bytes.Equal(head[:4], []byte{0x1A, 0x45, 0xDF, 0xA3}):
		return formatWebM, true
	case len(head) >= 4 && string(head[:4]) == "OggS":
		return formatOgg, true
	}
	return format{}, false
}

func contentTypeForKey(key string) string {
	switch path.Ext(key) {
	case ".jpg":
		return "image/jpeg"
	case ".m4a", ".mp4":
		return "audio/mp4"
	case ".webm":
		return "audio/webm"
	case ".ogg":
		return "audio/ogg"
	}
	return "application/octet-stream"
}

type uploadMeta struct {
	kind       dbgen.AttachmentKind
	recordID   *uuid.UUID
	durationMs *int32
	caption    *string
	sortOrder  *int32
}

// readUploadFields consumes form fields up to the file part, which must come last.
func readUploadFields(mr *multipart.Reader) (uploadMeta, *multipart.Part, error) {
	var m uploadMeta
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			return m, nil, errs.Validation("缺少文件", map[string]string{"file": "required"})
		}
		if err != nil {
			return m, nil, errs.BadRequest("上传内容格式不正确")
		}
		name := part.FormName()
		if name == "file" {
			return m, part, nil
		}
		b, err := io.ReadAll(io.LimitReader(part, 4096))
		part.Close()
		if err != nil {
			return m, nil, errs.BadRequest("上传内容格式不正确")
		}
		v := strings.TrimSpace(string(b))
		switch name {
		case "kind":
			m.kind = dbgen.AttachmentKind(v)
		case "recordId":
			if v != "" {
				id, err := uuid.Parse(v)
				if err != nil {
					return m, nil, errs.Validation("recordId 格式不正确", map[string]string{"recordId": "invalid"})
				}
				m.recordID = &id
			}
		case "durationMs":
			if v != "" {
				n, err := strconv.Atoi(v)
				if err != nil || n < 0 {
					return m, nil, errs.Validation("语音时长不正确", map[string]string{"durationMs": "invalid"})
				}
				m.durationMs = ptr(int32(min(n, 1<<30)))
			}
		case "caption":
			m.caption = &v
		case "sortOrder":
			if v != "" {
				n, err := strconv.Atoi(v)
				if err != nil {
					return m, nil, errs.Validation("顺序不正确", map[string]string{"sortOrder": "invalid"})
				}
				m.sortOrder = ptr(int32(n))
			}
		}
	}
}

func (s *Service) validateUpload(ctx context.Context, q *dbgen.Queries, family uuid.UUID, m *uploadMeta) (maxBytes int64, err error) {
	var fe errs.Fields
	switch m.kind {
	case dbgen.AttachmentKindPhoto:
		maxBytes = maxPhotoBytes
	case dbgen.AttachmentKindAudio:
		maxBytes = maxAudioBytes
		if m.durationMs != nil && *m.durationMs > maxAudioMs {
			fe.Add("durationMs", "too_long", "每段语音最长 3 分钟")
		}
	case dbgen.AttachmentKindAvatar:
		maxBytes = maxAvatarBytes
	default:
		fe.Add("kind", "invalid", "附件类型只能是 photo、audio 或 avatar")
		return 0, fe.Err()
	}
	if m.kind == dbgen.AttachmentKindAvatar {
		m.recordID = nil
	} else if m.recordID == nil {
		fe.Add("recordId", "required", "请先保存记录再上传附件")
	} else {
		if _, err := q.GetRecordForUpdate(ctx, dbgen.GetRecordForUpdateParams{FamilyID: family, ID: *m.recordID}); err != nil {
			if !store.IsNotFound(err) {
				return 0, err
			}
			fe.Add("recordId", "not_found", "记录不存在")
		} else if m.kind == dbgen.AttachmentKindPhoto {
			n, err := q.CountRecordPhotos(ctx, m.recordID)
			if err != nil {
				return 0, err
			}
			if n >= maxPhotosPerRec {
				fe.Add("file", "too_many_photos", "每条记录最多 9 张照片")
			}
		}
	}
	if m.caption != nil {
		if *m.caption == "" || m.kind != dbgen.AttachmentKindAudio {
			m.caption = nil
		} else if utf8.RuneCountInString(*m.caption) > 200 {
			fe.Add("caption", "too_long", "补充文字不超过 200 个字")
		}
	}
	return maxBytes, fe.Err()
}

// UploadAttachment stores a file under a client-generated ID. A repeated upload of the same
// ID returns the existing attachment with created=false.
func (s *Service) UploadAttachment(ctx context.Context, p auth.Principal, id uuid.UUID, mr *multipart.Reader) (dbgen.Attachment, bool, error) {
	meta, part, err := readUploadFields(mr)
	if err != nil {
		return dbgen.Attachment{}, false, err
	}
	defer part.Close()

	if existing, err := s.store.GetAttachmentAnyFamily(ctx, id); err == nil {
		if existing.FamilyID != p.FamilyID {
			return dbgen.Attachment{}, false, errs.Conflict("附件 ID 冲突，请重试")
		}
		return existing, false, nil
	} else if !store.IsNotFound(err) {
		return dbgen.Attachment{}, false, err
	}

	maxBytes, err := s.validateUpload(ctx, s.store.Queries, p.FamilyID, &meta)
	if err != nil {
		return dbgen.Attachment{}, false, err
	}

	br := bufio.NewReaderSize(part, 512)
	head, _ := br.Peek(16)
	fm, ok := sniff(head)
	wantImage := meta.kind != dbgen.AttachmentKindAudio
	if !ok || (fm == formatJPEG) != wantImage {
		msg := "语音格式不支持，请用 mp4、webm 或 ogg"
		if wantImage {
			msg = "照片需为 JPEG 格式"
		}
		return dbgen.Attachment{}, false, errs.Validation(msg, map[string]string{"file": "unsupported_type"})
	}

	now := time.Now()
	fam := p.FamilyID.String()
	originalKey := storage.Key(fam, id.String(), now, "original."+fm.ext)
	size, err := s.files.Put(ctx, originalKey, io.LimitReader(br, maxBytes+1))
	if err != nil {
		return dbgen.Attachment{}, false, fmt.Errorf("store upload: %w", err)
	}
	cleanup := []string{originalKey}
	fail := func(err error) (dbgen.Attachment, bool, error) {
		for _, k := range cleanup {
			_ = s.files.Delete(ctx, k)
		}
		return dbgen.Attachment{}, false, err
	}
	if size > maxBytes {
		return fail(errs.TooLarge(fmt.Sprintf("文件不能超过 %d MB", maxBytes>>20)))
	}
	if size == 0 {
		return fail(errs.Validation("文件是空的", map[string]string{"file": "empty"}))
	}

	params := dbgen.InsertAttachmentParams{
		ID: id, FamilyID: p.FamilyID, RecordID: meta.recordID, Kind: meta.kind, OriginalKey: originalKey,
		Mime: fm.mime, SizeBytes: size, DurationMs: meta.durationMs, Caption: meta.caption,
	}
	if meta.kind == dbgen.AttachmentKindAudio {
		params.Status = dbgen.AttachmentStatusProcessing
	} else {
		thumbKey := storage.Key(fam, id.String(), now, "thumb.jpg")
		w, h, err := s.makeThumbnail(ctx, originalKey, thumbKey)
		if err != nil {
			return fail(errs.Validation("照片无法读取，请重新选择", map[string]string{"file": "unreadable"}))
		}
		cleanup = append(cleanup, thumbKey)
		params.Status = dbgen.AttachmentStatusReady
		params.StorageKey = &thumbKey
		params.Width, params.Height = ptr(int32(w)), ptr(int32(h))
		params.DurationMs = nil
	}

	var att dbgen.Attachment
	err = s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		if meta.recordID != nil {
			// Re-check under the record lock so concurrent uploads cannot exceed 9 photos.
			if _, err := s.validateUpload(ctx, q, p.FamilyID, &meta); err != nil {
				return err
			}
			if meta.sortOrder == nil {
				n, err := q.NextAttachmentSortOrder(ctx, meta.recordID)
				if err != nil {
					return err
				}
				meta.sortOrder = &n
			}
		}
		if meta.sortOrder != nil {
			params.SortOrder = *meta.sortOrder
		}
		att, err = q.InsertAttachment(ctx, params)
		if store.IsNotFound(err) {
			return errSentinelRollback // same ID inserted concurrently; the files are identical
		}
		if err != nil {
			return err
		}
		if meta.kind == dbgen.AttachmentKindAudio {
			if err := jobs.Enqueue(ctx, q, jobs.KindTranscodeAudio, jobs.TranscodePayload{AttachmentID: id}); err != nil {
				return err
			}
		}
		if meta.recordID != nil && meta.caption != nil {
			return refreshSearchText(ctx, q, p.FamilyID, *meta.recordID)
		}
		return nil
	})
	if errors.Is(err, errSentinelRollback) {
		att, err = s.store.GetAttachment(ctx, dbgen.GetAttachmentParams{FamilyID: p.FamilyID, ID: id})
		return att, false, err
	}
	if err != nil {
		return fail(err)
	}
	if meta.kind == dbgen.AttachmentKindAudio {
		s.wakeJobs()
	}
	return att, true, nil
}

func (s *Service) makeThumbnail(ctx context.Context, originalKey, thumbKey string) (w, h int, err error) {
	f, err := s.files.Open(ctx, originalKey)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	thumb, w, h, err := media.Thumbnail(f, thumbMaxSide)
	if err != nil {
		return 0, 0, err
	}
	_, err = s.files.Put(ctx, thumbKey, bytes.NewReader(thumb))
	return w, h, err
}

// refreshSearchText rebuilds a record's search text after its audio captions change.
func refreshSearchText(ctx context.Context, q *dbgen.Queries, family, recordID uuid.UUID) error {
	r, err := q.GetRecord(ctx, dbgen.GetRecordParams{FamilyID: family, ID: recordID})
	if err != nil {
		return err
	}
	captions, err := q.ListCaptionsByRecord(ctx, &recordID)
	if err != nil {
		return err
	}
	return q.SetRecordSearchText(ctx, dbgen.SetRecordSearchTextParams{
		FamilyID: family, ID: recordID, SearchText: searchText(fieldsFromRecord(r), derefAll(captions)),
	})
}

func (s *Service) UpdateAttachment(ctx context.Context, p auth.Principal, id uuid.UUID, in api.AttachmentPatch) (dbgen.Attachment, error) {
	var att dbgen.Attachment
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		cur, err := q.GetAttachment(ctx, dbgen.GetAttachmentParams{FamilyID: p.FamilyID, ID: id})
		if err != nil {
			return notFound(err, "附件不存在")
		}
		caption, order := cur.Caption, cur.SortOrder
		if in.Caption.IsSpecified() {
			if cur.Kind != dbgen.AttachmentKindAudio {
				return errs.Validation("只有语音可以补充文字", map[string]string{"caption": "not_allowed"})
			}
			applyNullable(in.Caption, &caption)
			if caption != nil {
				*caption = strings.TrimSpace(*caption)
				if *caption == "" {
					caption = nil
				} else if utf8.RuneCountInString(*caption) > 200 {
					return errs.Validation("补充文字不超过 200 个字", map[string]string{"caption": "too_long"})
				}
			}
		}
		if in.SortOrder != nil {
			order = int32(*in.SortOrder)
		}
		att, err = q.UpdateAttachmentMeta(ctx, dbgen.UpdateAttachmentMetaParams{FamilyID: p.FamilyID, ID: id, Caption: caption, SortOrder: order})
		if err != nil {
			return err
		}
		if att.RecordID != nil {
			return refreshSearchText(ctx, q, p.FamilyID, *att.RecordID)
		}
		return nil
	})
	return att, err
}

func (s *Service) DeleteAttachment(ctx context.Context, p auth.Principal, id uuid.UUID) error {
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		att, err := q.DeleteAttachment(ctx, dbgen.DeleteAttachmentParams{FamilyID: p.FamilyID, ID: id})
		if err != nil {
			return notFound(err, "附件不存在")
		}
		if att.RecordID != nil {
			if err := refreshSearchText(ctx, q, p.FamilyID, *att.RecordID); err != nil {
				return err
			}
		}
		return jobs.Enqueue(ctx, q, jobs.KindDeleteFiles, jobs.DeleteFilesPayload{Keys: appendKeys(nil, att.OriginalKey, att.StorageKey)})
	})
	if err == nil {
		s.wakeJobs()
	}
	return err
}

func (s *Service) ReprocessAttachment(ctx context.Context, p auth.Principal, id uuid.UUID) (dbgen.Attachment, error) {
	var att dbgen.Attachment
	err := s.store.WithTx(ctx, func(q *dbgen.Queries) error {
		cur, err := q.GetAttachment(ctx, dbgen.GetAttachmentParams{FamilyID: p.FamilyID, ID: id})
		if err != nil {
			return notFound(err, "附件不存在")
		}
		if cur.Kind != dbgen.AttachmentKindAudio || cur.Status != dbgen.AttachmentStatusFailed {
			return errs.Conflict("只有处理失败的语音可以重新处理")
		}
		if err := q.SetAttachmentStatus(ctx, dbgen.SetAttachmentStatusParams{ID: id, Status: dbgen.AttachmentStatusProcessing}); err != nil {
			return err
		}
		if err := jobs.Enqueue(ctx, q, jobs.KindTranscodeAudio, jobs.TranscodePayload{AttachmentID: id}); err != nil {
			return err
		}
		att, err = q.GetAttachment(ctx, dbgen.GetAttachmentParams{FamilyID: p.FamilyID, ID: id})
		return err
	})
	if err == nil {
		s.wakeJobs()
	}
	return att, err
}

// ---------- File access ----------

type FileAccess struct {
	Principal *auth.Principal
	// For print tokens: the family and member whose record attachments may be read.
	TokenFamily *uuid.UUID
	TokenMember *uuid.UUID
}

type OpenedFile struct {
	storage.File
	ContentType string
	ModTime     time.Time
	Name        string
}

func (s *Service) OpenAttachmentFile(ctx context.Context, id uuid.UUID, variant string, access FileAccess) (OpenedFile, error) {
	owner, err := s.store.GetAttachmentOwner(ctx, id)
	if err != nil {
		return OpenedFile{}, notFound(err, "附件不存在")
	}
	switch {
	case access.Principal != nil && access.Principal.FamilyID == owner.FamilyID:
	case access.TokenFamily != nil && *access.TokenFamily == owner.FamilyID &&
		owner.RecordMemberID != nil && access.TokenMember != nil && *owner.RecordMemberID == *access.TokenMember:
	case access.Principal == nil && access.TokenFamily == nil:
		return OpenedFile{}, errs.Unauthorized("请先登录")
	default:
		return OpenedFile{}, errs.NotFound("附件不存在")
	}
	att, err := s.store.GetAttachment(ctx, dbgen.GetAttachmentParams{FamilyID: owner.FamilyID, ID: id})
	if err != nil {
		return OpenedFile{}, notFound(err, "附件不存在")
	}

	key := att.OriginalKey
	switch variant {
	case "thumb":
		if att.Kind == dbgen.AttachmentKindAudio || att.StorageKey == nil {
			return OpenedFile{}, errs.NotFound("没有缩略图")
		}
		key = *att.StorageKey
	case "original":
	default:
		if att.Kind == dbgen.AttachmentKindAudio && att.Status == dbgen.AttachmentStatusReady && att.StorageKey != nil {
			key = *att.StorageKey
		}
	}
	f, err := s.files.Open(ctx, key)
	if errors.Is(err, storage.ErrNotFound) {
		return OpenedFile{}, errs.NotFound("文件不存在")
	}
	if err != nil {
		return OpenedFile{}, err
	}
	return OpenedFile{File: f, ContentType: contentTypeForKey(key), ModTime: att.UpdatedAt, Name: path.Base(key)}, nil
}

// ---------- Job handlers ----------

func (s *Service) TranscodeJob(ctx context.Context, payload []byte) error {
	var pl jobs.TranscodePayload
	if err := json.Unmarshal(payload, &pl); err != nil {
		return jobs.Permanent(err)
	}
	att, err := s.store.GetAttachmentAnyFamily(ctx, pl.AttachmentID)
	if store.IsNotFound(err) {
		return nil // deleted meanwhile
	}
	if err != nil {
		return err
	}
	if att.Kind != dbgen.AttachmentKindAudio {
		return jobs.Permanent(fmt.Errorf("attachment %s is not audio", att.ID))
	}

	in, cleanupIn, err := s.localCopy(ctx, att.OriginalKey)
	if err != nil {
		return err
	}
	defer cleanupIn()
	out, err := os.CreateTemp("", "transcode-*.m4a")
	if err != nil {
		return err
	}
	out.Close()
	defer os.Remove(out.Name())

	if err := media.TranscodeAudio(ctx, in, out.Name()); err != nil {
		return err
	}
	ms, err := media.ProbeDurationMs(ctx, out.Name())
	if err != nil {
		return err
	}
	f, err := os.Open(out.Name())
	if err != nil {
		return err
	}
	defer f.Close()
	key := path.Join(path.Dir(att.OriginalKey), "audio.m4a")
	if _, err := s.files.Put(ctx, key, f); err != nil {
		return err
	}
	return s.store.SetAttachmentProcessed(ctx, dbgen.SetAttachmentProcessedParams{
		ID: att.ID, StorageKey: &key, Mime: "audio/mp4", DurationMs: ptr(int32(min(ms, 1<<30))),
	})
}

func (s *Service) TranscodeFailed(ctx context.Context, payload []byte, _ error) {
	var pl jobs.TranscodePayload
	if json.Unmarshal(payload, &pl) == nil {
		_ = s.store.SetAttachmentStatus(ctx, dbgen.SetAttachmentStatusParams{ID: pl.AttachmentID, Status: dbgen.AttachmentStatusFailed})
	}
}

func (s *Service) DeleteFilesJob(ctx context.Context, payload []byte) error {
	var pl jobs.DeleteFilesPayload
	if err := json.Unmarshal(payload, &pl); err != nil {
		return jobs.Permanent(err)
	}
	var failed []error
	for _, k := range pl.Keys {
		if err := s.files.Delete(ctx, k); err != nil {
			failed = append(failed, err)
		}
	}
	return errors.Join(failed...)
}

// localCopy returns a filesystem path for key, copying to a temp file when the storage is remote.
func (s *Service) localCopy(ctx context.Context, key string) (string, func(), error) {
	if lp, ok := s.files.(storage.LocalPather); ok {
		p, err := lp.LocalPath(key)
		return p, func() {}, err
	}
	src, err := s.files.Open(ctx, key)
	if err != nil {
		return "", nil, err
	}
	defer src.Close()
	tmp, err := os.CreateTemp("", "media-*"+path.Ext(key))
	if err != nil {
		return "", nil, err
	}
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", nil, err
	}
	tmp.Close()
	return tmp.Name(), func() { os.Remove(tmp.Name()) }, nil
}
