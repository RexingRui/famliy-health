package apitest

import (
	"bytes"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/api"
)

func TestAuth(t *testing.T) {
	e := newEnv(t)
	e.account("mom")
	anon := e.anon()

	anon.do("GET", "/api/home", nil).expect(401)
	anon.do("POST", "/api/auth/login", map[string]string{"username": "mom", "password": "wrong-pass"}).expect(401)
	anon.do("POST", "/api/auth/login", map[string]string{"username": "nobody", "password": "wrong-pass"}).expect(401)

	c := anon
	res := c.do("POST", "/api/auth/login", map[string]string{"username": "mom", "password": "password-123"}).expect(200)
	must(t, strings.Contains(res.header.Get("Set-Cookie"), "Max-Age="), "remember defaults to a 30-day cookie: %s", res.header.Get("Set-Cookie"))
	var me api.Me
	c.do("GET", "/api/me", nil).expect(200).decode(&me)
	must(t, me.Account.Username == "mom" && me.Family.Name == "测试家庭", "me = %+v", me)

	c.do("POST", "/api/auth/logout", nil).expect(204)
	c.do("GET", "/api/me", nil).expect(401)

	// Unchecked "30 天内保持登录": a browser-session cookie backed by a short server-side session.
	res = c.do("POST", "/api/auth/login", map[string]any{"username": "mom", "password": "password-123", "remember": false}).expect(200)
	cookie := res.header.Get("Set-Cookie")
	must(t, strings.HasPrefix(cookie, "hl_sid=") && !strings.Contains(cookie, "Max-Age=") && !strings.Contains(cookie, "Expires="), "session cookie = %s", cookie)
	c.do("GET", "/api/me", nil).expect(200)
	var hours float64
	if err := e.pool.QueryRow(t.Context(), "SELECT extract(epoch FROM max(expires_at) - now()) / 3600 FROM sessions WHERE NOT persistent").Scan(&hours); err != nil {
		t.Fatal(err)
	}
	must(t, hours > 11.9 && hours <= 12, "browser session ttl = %.2fh", hours)

	// Writes without an Origin header are rejected (CSRF).
	c.raw("POST", "/api/auth/login", strings.NewReader(`{}`), "application/json", map[string]string{"Origin": "https://evil.example"}).expect(403)
}

func TestLoginLockout(t *testing.T) {
	e := newEnv(t)
	e.account("mom")
	c := e.anon()
	for range 5 {
		c.do("POST", "/api/auth/login", map[string]string{"username": "mom", "password": "nope-nope"}).expect(401)
	}
	res := c.do("POST", "/api/auth/login", map[string]string{"username": "mom", "password": "password-123"}).expect(429)
	code, _ := res.errorFields()
	must(t, code == "too_many_requests", "code = %s", code)
}

func TestMembers(t *testing.T) {
	e := newEnv(t)
	c := e.account("mom")

	res := c.do("POST", "/api/members", map[string]any{"nickname": " ", "relation": "cousin", "gender": "male", "birthDate": "2999-01-01"}).expect(422)
	_, fields := res.errorFields()
	for _, f := range []string{"nickname", "relation", "birthDate"} {
		must(t, fields[f] != "", "missing field error %s: %v", f, fields)
	}

	var m api.Member
	c.do("POST", "/api/members", map[string]any{
		"nickname": "小明", "relation": "child", "gender": "male", "birthDate": "2019-05-02", "allergies": "花粉", "bloodType": "A",
	}).expect(201).decode(&m)
	must(t, m.Allergies != nil && *m.Allergies == "花粉" && m.BloodType != nil, "created = %+v", m)

	// null clears, absent keeps.
	c.do("PATCH", "/api/members/"+m.Id.String(), map[string]any{"allergies": nil, "nickname": "明明"}).expect(200).decode(&m)
	must(t, m.Allergies == nil && m.Nickname == "明明" && m.BloodType != nil && *m.BloodType == api.BloodTypeA, "patched = %+v", m)

	c.do("POST", "/api/members/"+m.Id.String()+"/archive", nil).expect(200).decode(&m)
	must(t, m.Archived, "not archived")
	var list []api.Member
	c.do("GET", "/api/members", nil).expect(200).decode(&list)
	must(t, len(list) == 0, "archived member listed")
	c.do("GET", "/api/members?includeArchived=true", nil).expect(200).decode(&list)
	must(t, len(list) == 1, "includeArchived = %d", len(list))

	c.do("DELETE", "/api/members/"+m.Id.String()+"?confirm=false", nil).expect(400)
	c.do("DELETE", "/api/members/"+m.Id.String()+"?confirm=true", nil).expect(204)
	c.do("GET", "/api/members/"+m.Id.String(), nil).expect(404)
}

func TestEpisodeLifecycle(t *testing.T) {
	e := newEnv(t)
	c := e.account("mom")
	m := c.createMember("小明")

	ep := c.createEpisode(m.Id, "发烧", "short")
	month := time.Now().In(time.FixedZone("CST", 8*3600)).Format("2006-01")
	must(t, ep.Name == "发烧 · "+month && ep.Status == api.EpisodeStatusActive && ep.Open && ep.Days == 1, "episode = %+v", ep)

	// No presets: the family's tags are the ones its episodes introduced.
	var tags []api.DiseaseTag
	c.do("GET", "/api/disease-tags", nil).expect(200).decode(&tags)
	must(t, len(tags) == 1 && tags[0].Name == "发烧", "tags = %+v", tags)

	// Diagnosis renames a still-default episode name.
	c.do("PATCH", "/api/episodes/"+ep.Id.String(), map[string]any{"diseaseName": "支原体肺炎"}).expect(200).decode(&ep)
	must(t, ep.DiseaseName == "支原体肺炎" && ep.Name == "支原体肺炎 · "+month, "renamed = %+v", ep)

	res := c.do("PATCH", "/api/episodes/"+ep.Id.String(), map[string]any{"status": "stable"}).expect(422)
	_, fields := res.errorFields()
	must(t, fields["status"] == "invalid_for_kind", "fields = %v", fields)

	c.do("PATCH", "/api/episodes/"+ep.Id.String(), map[string]any{"status": "recovered"}).expect(200).decode(&ep)
	must(t, !ep.Open && ep.EndedOn != nil, "closed = %+v", ep)
	c.do("PATCH", "/api/episodes/"+ep.Id.String(), map[string]any{"status": "active"}).expect(200).decode(&ep)
	must(t, ep.Open && ep.EndedOn == nil, "reopened = %+v", ep)

	// Short → long keeps the records and maps the status.
	c.do("PATCH", "/api/episodes/"+ep.Id.String(), map[string]any{"status": "recovered"}).expect(200)
	c.do("PATCH", "/api/episodes/"+ep.Id.String(), map[string]any{"kind": "long"}).expect(200).decode(&ep)
	must(t, ep.Kind == api.EpisodeKindLong && ep.Status == api.EpisodeStatusStable && ep.Name == "支原体肺炎", "to long = %+v", ep)
	c.do("PATCH", "/api/episodes/"+ep.Id.String(), map[string]any{"kind": "short"}).expect(422)

	// A flare record returns to the inbox unflagged when its episode is deleted.
	rec := c.putRecord(newID(t), map[string]any{
		"memberId": m.Id, "episodeId": ep.Id, "occurredAt": time.Now(), "type": "symptom", "severity": 8, "isFlare": true,
	})
	must(t, rec.IsFlare, "flare not set")
	c.do("DELETE", "/api/episodes/"+ep.Id.String(), nil).expect(204)
	c.do("GET", "/api/records/"+rec.Id.String(), nil).expect(200).decode(&rec)
	must(t, rec.EpisodeId == nil && !rec.IsFlare, "after delete = %+v", rec)
}

func TestRecordValidationAndIdempotency(t *testing.T) {
	e := newEnv(t)
	c := e.account("mom")
	m := c.createMember("小明")
	ep := c.createEpisode(m.Id, "感冒", "short")
	id := newID(t)

	body := map[string]any{
		"memberId": m.Id, "episodeId": ep.Id, "occurredAt": time.Now().Add(-3 * time.Hour),
		"type": "temperature", "temperature": 38.64, "body": "  晚上有点烧  ",
	}
	var first, second api.Record
	c.do("PUT", "/api/records/"+id.String(), body).expect(201).decode(&first)
	must(t, *first.Temperature == 38.6 && first.Body == "晚上有点烧" && first.Backfilled, "first = %+v", first)
	body["temperature"] = 39.9 // a retry never overwrites
	c.do("PUT", "/api/records/"+id.String(), body).expect(200).decode(&second)
	must(t, *second.Temperature == 38.6, "retry changed record")

	cases := []struct {
		body  map[string]any
		field string
	}{
		{map[string]any{"type": "temperature", "severity": 3}, "severity"},
		{map[string]any{"type": "temperature", "temperature": 45}, "temperature"},
		{map[string]any{"type": "symptom", "isFlare": true}, "isFlare"},
		{map[string]any{"medName": "布洛芬"}, "medName"},
		{map[string]any{"type": "visit", "details": map[string]any{"item": "血常规"}}, "details.item"},
		{map[string]any{"occurredAt": time.Now().Add(time.Hour)}, "occurredAt"},
	}
	for _, tc := range cases {
		b := map[string]any{"memberId": m.Id, "episodeId": ep.Id, "occurredAt": time.Now()}
		for k, v := range tc.body {
			b[k] = v
		}
		_, fields := c.do("PUT", "/api/records/"+newID(t).String(), b).expect(422).errorFields()
		must(t, fields[tc.field] != "", "%v: fields = %v", tc.body, fields)
	}

	// Changing the type drops fields of the old type.
	var r api.Record
	c.do("PATCH", "/api/records/"+id.String(), map[string]any{"type": "medication", "medName": "布洛芬", "medDose": 5, "medUnit": "ml"}).expect(200).decode(&r)
	must(t, r.Temperature == nil && *r.MedName == "布洛芬" && *r.MedUnit == api.MedUnitMl, "patched = %+v", r)

	// Inline new episode, and it must belong to the same member.
	other := c.createMember("奶奶")
	var withNew api.Record
	c.do("PUT", "/api/records/"+newID(t).String(), map[string]any{
		"memberId": other.Id, "occurredAt": time.Now(), "newEpisode": map[string]any{"diseaseName": "高血压", "kind": "long"},
	}).expect(201).decode(&withNew)
	must(t, withNew.EpisodeId != nil, "no episode created")
	_, fields := c.do("PUT", "/api/records/"+newID(t).String(), map[string]any{
		"memberId": m.Id, "episodeId": withNew.EpisodeId, "occurredAt": time.Now(),
	}).expect(422).errorFields()
	must(t, fields["episodeId"] == "member_mismatch", "fields = %v", fields)
}

func TestRecordListingSearchAndAssign(t *testing.T) {
	e := newEnv(t)
	c := e.account("mom")
	m := c.createMember("小明")
	grandma := c.createMember("奶奶")
	base := time.Now().Add(-10 * time.Hour)

	var ids []uuid.UUID
	for i := range 5 {
		id := newID(t)
		ids = append(ids, id)
		c.putRecord(id, map[string]any{"memberId": m.Id, "occurredAt": base.Add(time.Duration(i) * time.Hour), "body": "记录" + strconv.Itoa(i)})
	}
	c.putRecord(newID(t), map[string]any{
		"memberId": m.Id, "occurredAt": base, "type": "medication", "medName": "止咳糖浆", "medDose": 5, "medUnit": "ml",
	})
	c.putRecord(newID(t), map[string]any{
		"memberId": m.Id, "occurredAt": base, "type": "visit", "details": map[string]any{"hospital": "儿童医院"}, "costCents": 5000,
	})
	grandmaRec := c.putRecord(newID(t), map[string]any{"memberId": grandma.Id, "occurredAt": base, "body": "100%_好"})

	var page api.RecordPage
	c.do("GET", "/api/records?inbox=true&limit=3", nil).expect(200).decode(&page)
	must(t, len(page.Items) == 3 && page.NextCursor != nil, "page1 = %d", len(page.Items))
	must(t, page.Items[0].Body == "记录4", "not newest first: %s", page.Items[0].Body)
	seen := len(page.Items)
	for page.NextCursor != nil {
		c.do("GET", "/api/records?inbox=true&limit=3&cursor="+*page.NextCursor, nil).expect(200).decode(&page)
		seen += len(page.Items)
	}
	must(t, seen == 8, "paged through %d records", seen)

	c.do("GET", "/api/records?q=糖浆", nil).expect(200).decode(&page)
	must(t, len(page.Items) == 1, "search medName = %d", len(page.Items))
	c.do("GET", "/api/records?q=儿童医院", nil).expect(200).decode(&page)
	must(t, len(page.Items) == 1, "search hospital = %d", len(page.Items))
	c.do("GET", "/api/records?q=0%25_", nil).expect(200).decode(&page)
	must(t, len(page.Items) == 1 && page.Items[0].Id == grandmaRec.Id, "LIKE metacharacters not escaped")
	c.do("GET", "/api/records?type=visit&type=medication", nil).expect(200).decode(&page)
	must(t, len(page.Items) == 2, "type filter = %d", len(page.Items))

	var last api.LastMedication
	c.do("GET", "/api/medications/last?memberId="+m.Id.String()+"&medName=止咳糖浆", nil).expect(200).decode(&last)
	must(t, last.Last != nil && last.Last.HoursSince >= 9.9 && last.Last.HoursSince <= 10.1, "last = %+v", last.Last)

	// Batch assignment into a new episode; mixing members is refused.
	_, fields := c.do("POST", "/api/records/assign", map[string]any{"ids": []uuid.UUID{ids[0], grandmaRec.Id}, "episodeId": nil}).expect(422).errorFields()
	must(t, fields["ids"] == "member_mismatch", "fields = %v", fields)
	var res api.AssignResult
	c.do("POST", "/api/records/assign", map[string]any{
		"ids": ids[:3], "episodeId": nil, "newEpisode": map[string]any{"diseaseName": "感冒", "kind": "short"},
	}).expect(200).decode(&res)
	must(t, res.Updated == 3 && res.EpisodeId != nil, "assign = %+v", res)

	var home api.Home
	c.do("GET", "/api/home", nil).expect(200).decode(&home)
	must(t, home.InboxCount == 5, "inbox = %d", home.InboxCount)

	c.do("POST", "/api/records/assign", map[string]any{"ids": ids[:1], "episodeId": nil}).expect(200)
	c.do("GET", "/api/home", nil).expect(200).decode(&home)
	must(t, home.InboxCount == 6, "inbox after unassign = %d", home.InboxCount)
}

func TestHomeCalendarTrendByDisease(t *testing.T) {
	e := newEnv(t)
	c := e.account("mom")
	m := c.createMember("小明")
	ep := c.createEpisode(m.Id, "感冒", "short")
	now := time.Now()

	c.putRecord(newID(t), map[string]any{"memberId": m.Id, "episodeId": ep.Id, "occurredAt": now.Add(-2 * time.Hour), "type": "temperature", "temperature": 38.6})
	c.putRecord(newID(t), map[string]any{"memberId": m.Id, "episodeId": ep.Id, "occurredAt": now.Add(-time.Hour), "type": "temperature", "temperature": 37.8})
	c.putRecord(newID(t), map[string]any{"memberId": m.Id, "episodeId": ep.Id, "occurredAt": now.Add(-90 * time.Minute), "type": "medication", "medName": "退烧药", "medDose": 4, "medUnit": "ml"})
	c.putRecord(newID(t), map[string]any{"memberId": m.Id, "episodeId": ep.Id, "occurredAt": now.Add(-30 * time.Minute), "type": "symptom", "severity": 4})

	var home api.Home
	c.do("GET", "/api/home", nil).expect(200).decode(&home)
	must(t, len(home.Members) == 1 && len(home.Members[0].OpenEpisodes) == 1, "home = %+v", home)
	s := home.Members[0].OpenEpisodes[0]
	must(t, s.LatestTemperature != nil && s.LatestTemperature.Value == 37.8, "latest temp = %+v", s.LatestTemperature)
	must(t, s.LastMedication != nil && s.LastMedication.MedName == "退烧药", "last med = %+v", s.LastMedication)
	must(t, len(s.Week) >= 1 && s.Episode.RecordCount == 4, "week/records = %d/%d", len(s.Week), s.Episode.RecordCount)
	must(t, len(home.Members[0].RecentRecords) == 4, "recent = %d", len(home.Members[0].RecentRecords))

	month := now.In(time.FixedZone("CST", 8*3600)).Format("2006-01")
	var cal api.Calendar
	c.do("GET", "/api/episodes/"+ep.Id.String()+"/calendar?month="+month, nil).expect(200).decode(&cal)
	total := 0
	for _, d := range cal.Days {
		total += d.Counts.Temperature + d.Counts.Medication + d.Counts.Symptom
	}
	must(t, total == 4, "calendar counts = %d", total)
	c.do("GET", "/api/episodes/"+ep.Id.String()+"/calendar?month=2026-13", nil).expect(400)

	var trend api.Trend
	c.do("GET", "/api/episodes/"+ep.Id.String()+"/trend", nil).expect(200).decode(&trend)
	must(t, len(trend.Temperature) == 2 && len(trend.Severity) == 1, "trend = %+v", trend)

	c.do("PATCH", "/api/episodes/"+ep.Id.String(), map[string]any{"status": "recovered"}).expect(200)
	c.createEpisode(m.Id, "感冒", "short")
	var bd api.ByDisease
	c.do("GET", "/api/members/"+m.Id.String()+"/by-disease?range=1y", nil).expect(200).decode(&bd)
	must(t, len(bd.Diseases) == 1 && bd.Diseases[0].EpisodeCount == 2, "by disease = %+v", bd)
	d := bd.Diseases[0]
	must(t, d.RecoveredAvgDays != nil && len(d.TopMedications) == 1 && d.TopMedications[0].Name == "退烧药", "summary = %+v", d)
}

func TestFamilyIsolation(t *testing.T) {
	e := newEnv(t)
	mom := e.account("mom")
	m := mom.createMember("小明")
	rec := mom.putRecord(newID(t), map[string]any{"memberId": m.Id, "occurredAt": time.Now()})
	photo := newID(t)
	mom.upload(photo, map[string]string{"kind": "photo", "recordId": rec.Id.String()}, jpegBytes(t, 50, 50)).expect(201)

	// A second family (created directly: CreateAccount only ever joins the first family).
	ctx := t.Context()
	var otherFamily uuid.UUID
	if err := e.st.Pool.QueryRow(ctx, `INSERT INTO families (id, name) VALUES (gen_random_uuid(), 'other') RETURNING id`).Scan(&otherFamily); err != nil {
		t.Fatal(err)
	}
	acct, err := e.svc.CreateAccount(ctx, "stranger", "password-123", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.st.Pool.Exec(ctx, `UPDATE family_memberships SET family_id = $1 WHERE account_id = $2`, otherFamily, acct.ID); err != nil {
		t.Fatal(err)
	}
	stranger := e.anon()
	stranger.do("POST", "/api/auth/login", map[string]string{"username": "stranger", "password": "password-123"}).expect(200)

	stranger.do("GET", "/api/members/"+m.Id.String(), nil).expect(404)
	stranger.do("GET", "/api/records/"+rec.Id.String(), nil).expect(404)
	stranger.do("GET", "/api/attachments/"+photo.String()+"/file", nil).expect(404)
	stranger.do("PUT", "/api/records/"+rec.Id.String(), map[string]any{"memberId": m.Id, "occurredAt": time.Now()}).expect(409)
	_, fields := stranger.do("PUT", "/api/records/"+newID(t).String(), map[string]any{"memberId": m.Id, "occurredAt": time.Now()}).expect(422).errorFields()
	must(t, fields["memberId"] == "not_found", "fields = %v", fields)
	var page api.RecordPage
	stranger.do("GET", "/api/records", nil).expect(200).decode(&page)
	must(t, len(page.Items) == 0, "stranger sees %d records", len(page.Items))
}

func TestPhotoAttachments(t *testing.T) {
	e := newEnv(t)
	c := e.account("mom")
	m := c.createMember("小明")
	rec := c.putRecord(newID(t), map[string]any{"memberId": m.Id, "occurredAt": time.Now()})

	id := newID(t)
	var a api.Attachment
	c.upload(id, map[string]string{"kind": "photo", "recordId": rec.Id.String()}, jpegBytes(t, 1200, 800)).expect(201).decode(&a)
	must(t, a.Status == api.AttachmentStatusReady && *a.Width == 1200 && a.ThumbUrl != nil, "photo = %+v", a)
	c.upload(id, map[string]string{"kind": "photo", "recordId": rec.Id.String()}, jpegBytes(t, 10, 10)).expect(200)

	thumb := c.do("GET", *a.ThumbUrl, nil).expect(200)
	must(t, thumb.header.Get("Content-Type") == "image/jpeg" && len(thumb.body) > 0, "thumb headers = %v", thumb.header)
	part := c.raw("GET", a.Url, nil, "", map[string]string{"Range": "bytes=0-9"}).expect(206)
	must(t, len(part.body) == 10, "range body = %d bytes", len(part.body))
	e.anon().do("GET", a.Url, nil).expect(401)

	_, fields := c.upload(newID(t), map[string]string{"kind": "photo", "recordId": rec.Id.String()}, []byte("GIF89a....")).expect(422).errorFields()
	must(t, fields["file"] == "unsupported_type", "fields = %v", fields)
	for range 8 {
		c.upload(newID(t), map[string]string{"kind": "photo", "recordId": rec.Id.String()}, jpegBytes(t, 20, 20)).expect(201)
	}
	_, fields = c.upload(newID(t), map[string]string{"kind": "photo", "recordId": rec.Id.String()}, jpegBytes(t, 20, 20)).expect(422).errorFields()
	must(t, fields["file"] == "too_many_photos", "10th photo: %v", fields)

	var r api.Record
	c.do("GET", "/api/records/"+rec.Id.String(), nil).expect(200).decode(&r)
	must(t, len(r.Attachments) == 9, "attachments = %d", len(r.Attachments))

	// Deleting the record removes the files through the job queue.
	c.do("DELETE", "/api/records/"+rec.Id.String(), nil).expect(204)
	e.runJobs()
	var left int
	_ = filepath.Walk(e.files.Dir, func(_ string, info os.FileInfo, _ error) error {
		if info != nil && !info.IsDir() {
			left++
		}
		return nil
	})
	must(t, left == 0, "%d files left after delete", left)
}

func TestAvatar(t *testing.T) {
	e := newEnv(t)
	c := e.account("mom")
	id := newID(t)
	c.upload(id, map[string]string{"kind": "avatar"}, jpegBytes(t, 300, 300)).expect(201)
	var m api.Member
	c.do("POST", "/api/members", map[string]any{
		"nickname": "小明", "relation": "child", "gender": "male", "birthDate": "2019-05-02", "avatarId": id,
	}).expect(201).decode(&m)
	must(t, m.AvatarUrl != nil, "no avatar url")
	c.do("GET", *m.AvatarUrl, nil).expect(200)
	c.do("PATCH", "/api/members/"+m.Id.String(), map[string]any{"avatarId": nil}).expect(200).decode(&m)
	must(t, m.AvatarId == nil, "avatar not cleared")
}

func TestAudioTranscodeAndCaption(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	e := newEnv(t)
	c := e.account("mom")
	m := c.createMember("小明")
	rec := c.putRecord(newID(t), map[string]any{"memberId": m.Id, "occurredAt": time.Now()})

	src := filepath.Join(t.TempDir(), "voice.webm")
	if out, err := exec.Command("ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-c:a", "libopus", src).CombinedOutput(); err != nil {
		t.Skipf("cannot create webm fixture: %v %s", err, out)
	}
	data, _ := os.ReadFile(src)

	id := newID(t)
	var a api.Attachment
	c.upload(id, map[string]string{"kind": "audio", "recordId": rec.Id.String(), "durationMs": "3000", "caption": "咳嗽比昨天少"}, data).expect(201).decode(&a)
	must(t, a.Status == api.AttachmentStatusProcessing && a.Mime == "audio/webm", "audio = %+v", a)

	var page api.RecordPage
	c.do("GET", "/api/records?q=咳嗽", nil).expect(200).decode(&page)
	must(t, len(page.Items) == 1, "caption not searchable")

	e.runJobs()
	var r api.Record
	c.do("GET", "/api/records/"+rec.Id.String(), nil).expect(200).decode(&r)
	got := r.Attachments[0]
	must(t, got.Status == api.AttachmentStatusReady && got.Mime == "audio/mp4" && *got.DurationMs > 2500, "transcoded = %+v", got)
	file := c.do("GET", got.Url, nil).expect(200)
	must(t, file.header.Get("Content-Type") == "audio/mp4" && bytes.Contains(file.body[:16], []byte("ftyp")), "served %s", file.header.Get("Content-Type"))

	c.do("PATCH", "/api/attachments/"+id.String(), map[string]any{"caption": nil}).expect(200)
	c.do("GET", "/api/records?q=咳嗽", nil).expect(200).decode(&page)
	must(t, len(page.Items) == 0, "cleared caption still searchable")

	_, fields := c.upload(newID(t), map[string]string{"kind": "audio", "recordId": rec.Id.String(), "durationMs": "200000"}, data).expect(422).errorFields()
	must(t, fields["durationMs"] == "too_long", "fields = %v", fields)
}

func TestExportAndPrintToken(t *testing.T) {
	e := newEnv(t)
	c := e.account("mom")
	m := c.createMember("小明")
	other := c.createMember("奶奶")
	ep := c.createEpisode(m.Id, "感冒", "short")
	rec := c.putRecord(newID(t), map[string]any{"memberId": m.Id, "episodeId": ep.Id, "occurredAt": time.Now(), "type": "visit", "costCents": 12000})
	photo := newID(t)
	c.upload(photo, map[string]string{"kind": "photo", "recordId": rec.Id.String()}, jpegBytes(t, 40, 40)).expect(201)
	otherRec := c.putRecord(newID(t), map[string]any{"memberId": other.Id, "occurredAt": time.Now()})
	otherPhoto := newID(t)
	c.upload(otherPhoto, map[string]string{"kind": "photo", "recordId": otherRec.Id.String()}, jpegBytes(t, 40, 40)).expect(201)

	res := c.do("POST", "/api/exports", map[string]any{"type": "episode", "episodeId": ep.Id, "photos": "thumbnail"}).expect(200)
	must(t, string(res.body) == "%PDF-1.7 fake" && res.header.Get("Content-Type") == "application/pdf", "pdf = %q", res.body)
	must(t, strings.Contains(res.header.Get("Content-Disposition"), "filename*=UTF-8''"), "disposition = %s", res.header.Get("Content-Disposition"))
	c.do("POST", "/api/exports", map[string]any{"type": "episode", "photos": "none"}).expect(422)

	e.mu.Lock()
	printURL := e.printURLs[len(e.printURLs)-1]
	e.mu.Unlock()
	must(t, strings.HasPrefix(printURL, "http://app.internal:8080/print/episode/"+ep.Id.String()+"?token="), "print url = %s", printURL)
	token := printURL[strings.Index(printURL, "token=")+len("token="):]

	// Gotenberg has no cookie: the token alone must fetch the data and this member's files.
	anon := e.anon()
	var pd api.PrintData
	anon.do("GET", "/api/print-data?token="+token, nil).expect(200).decode(&pd)
	must(t, pd.Episode != nil && pd.Episode.Id == ep.Id && len(pd.Records) == 1 && pd.CostTotalCents == 12000, "print data = %+v", pd)
	anon.do("GET", "/api/attachments/"+photo.String()+"/file?variant=thumb&token="+token, nil).expect(200)
	anon.do("GET", "/api/attachments/"+otherPhoto.String()+"/file?token="+token, nil).expect(404)
	anon.do("GET", "/api/print-data?token=forged.token", nil).expect(401)
	anon.do("GET", "/api/print-data?type=episode&id="+ep.Id.String(), nil).expect(401)

	// The logged-in preview uses query parameters instead of a token.
	c.do("GET", "/api/print-data?type=member&id="+m.Id.String(), nil).expect(200).decode(&pd)
	must(t, pd.Type == api.ReportTypeMember && len(pd.Episodes) == 1 && pd.Token == nil, "member report = %+v", pd)

	// The sections picked on the export page reach the print page; without them it shows everything.
	c.do("POST", "/api/exports", map[string]any{"type": "episode", "episodeId": ep.Id, "photos": "none", "sections": []string{"meds", "timeline"}}).expect(200)
	e.mu.Lock()
	printURL = e.printURLs[len(e.printURLs)-1]
	e.mu.Unlock()
	must(t, strings.Contains(printURL, "?sections=meds%2Ctimeline&token="), "print url = %s", printURL)
	c.do("POST", "/api/exports", map[string]any{"type": "episode", "episodeId": ep.Id, "photos": "none", "sections": []string{}}).expect(200)
	e.mu.Lock()
	printURL = e.printURLs[len(e.printURLs)-1]
	e.mu.Unlock()
	must(t, strings.Contains(printURL, "?sections=&token="), "print url = %s", printURL)
	c.do("POST", "/api/exports", map[string]any{"type": "episode", "episodeId": ep.Id, "photos": "none", "sections": []string{"costs"}}).expect(422)
}

func TestHealthz(t *testing.T) {
	e := newEnv(t)
	var h api.Health
	e.anon().do("GET", "/healthz", nil).expect(200).decode(&h)
	must(t, h.Checks["database"] == "ok", "health = %+v", h)
}

func TestBasePathDeployment(t *testing.T) {
	e := newEnvAt(t, "/health")
	c := e.anon()
	if _, err := e.svc.CreateAccount(t.Context(), "mom", "password-123", "", "家"); err != nil {
		t.Fatal(err)
	}
	res := c.do("POST", "/api/auth/login", map[string]string{"username": "mom", "password": "password-123"}).expect(200)
	cookie := res.header.Get("Set-Cookie")
	must(t, strings.HasPrefix(cookie, "hl_sid=") && strings.Contains(cookie, "Path=/health/"), "cookie = %s", cookie)

	m := c.createMember("小明")
	rec := c.putRecord(newID(t), map[string]any{"memberId": m.Id, "occurredAt": time.Now()})
	var a api.Attachment
	c.upload(newID(t), map[string]string{"kind": "photo", "recordId": rec.Id.String()}, jpegBytes(t, 40, 40)).expect(201).decode(&a)
	must(t, strings.HasPrefix(a.Url, "/health/api/attachments/") && strings.HasPrefix(*a.ThumbUrl, "/health/"), "urls = %s %s", a.Url, *a.ThumbUrl)
	c.do("GET", a.Url, nil).expect(200)

	ep := c.createEpisode(m.Id, "感冒", "short")
	c.do("POST", "/api/exports", map[string]any{"type": "episode", "episodeId": ep.Id, "photos": "none"}).expect(200)
	e.mu.Lock()
	printURL := e.printURLs[len(e.printURLs)-1]
	e.mu.Unlock()
	must(t, strings.HasPrefix(printURL, "http://app.internal:8080/health/print/episode/"), "print url = %s", printURL)

	// Nothing answers outside the prefix, leaving the rest of the shared domain to other apps.
	res2, err := http.Get(e.srv.URL + "/api/me")
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	must(t, res2.StatusCode == 404, "outside prefix: %d", res2.StatusCode)
}
