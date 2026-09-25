package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/rexingrui/famliy-health/internal/store/dbgen"
	"github.com/rexingrui/famliy-health/internal/timex"
)

func withNow(t *testing.T, now time.Time) {
	t.Helper()
	prev := timex.Now
	timex.Now = func() time.Time { return now.In(timex.Loc) }
	t.Cleanup(func() { timex.Now = prev })
}

func TestStatusRules(t *testing.T) {
	for _, tc := range []struct {
		kind dbgen.EpisodeKind
		st   dbgen.EpisodeStatus
		ok   bool
	}{
		{dbgen.EpisodeKindShort, dbgen.EpisodeStatusActive, true},
		{dbgen.EpisodeKindShort, dbgen.EpisodeStatusRecovered, true},
		{dbgen.EpisodeKindShort, dbgen.EpisodeStatusStable, false},
		{dbgen.EpisodeKindLong, dbgen.EpisodeStatusTreating, true},
		{dbgen.EpisodeKindLong, dbgen.EpisodeStatusEnded, true},
		{dbgen.EpisodeKindLong, dbgen.EpisodeStatusActive, false},
	} {
		if got := statusAllowed(tc.kind, tc.st); got != tc.ok {
			t.Errorf("statusAllowed(%s, %s) = %v", tc.kind, tc.st, got)
		}
	}
	if longStatusFor(dbgen.EpisodeStatusActive) != dbgen.EpisodeStatusTreating ||
		longStatusFor(dbgen.EpisodeStatusRecovered) != dbgen.EpisodeStatusStable {
		t.Fatal("short→long status mapping wrong")
	}
}

func TestEpisodeFieldsNormalize(t *testing.T) {
	withNow(t, time.Date(2026, 9, 24, 21, 0, 0, 0, timex.Loc))
	tag := dbgen.DiseaseTag{Name: "感冒"}

	f := episodeFields{tag: tag, kind: dbgen.EpisodeKindShort, status: dbgen.EpisodeStatusRecovered, startedOn: time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)}
	if err := f.normalize(); err != nil {
		t.Fatal(err)
	}
	if f.name != "感冒 · 2026-09" || f.endedOn == nil || f.endedOn.Format("2006-01-02") != "2026-09-24" {
		t.Fatalf("normalized = %+v", f)
	}

	f = episodeFields{tag: tag, kind: dbgen.EpisodeKindLong, status: dbgen.EpisodeStatusTreating, startedOn: time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC), endedOn: ptr(time.Now())}
	if err := f.normalize(); err != nil || f.endedOn != nil || f.name != "感冒" {
		t.Fatalf("open long = %+v, %v", f, err)
	}

	f = episodeFields{tag: tag, kind: dbgen.EpisodeKindShort, status: dbgen.EpisodeStatusActive, startedOn: time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)}
	if err := f.normalize(); err == nil {
		t.Fatal("future start accepted")
	}
}

func TestEpisodeDaysAndRecoveryPrompt(t *testing.T) {
	withNow(t, time.Date(2026, 9, 24, 21, 0, 0, 0, timex.Loc))
	e := EpisodeView{Episode: dbgen.Episode{
		Kind: dbgen.EpisodeKindShort, Status: dbgen.EpisodeStatusActive, StartedOn: time.Date(2026, 9, 23, 0, 0, 0, 0, time.UTC),
	}}
	if e.Days() != 2 {
		t.Fatalf("day %d, want 第 2 天", e.Days())
	}
	if e.SuggestRecovered() {
		t.Fatal("prompt too early")
	}
	e.StartedOn = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	e.LastRecordAt = ptr(time.Date(2026, 9, 10, 8, 0, 0, 0, timex.Loc))
	if !e.SuggestRecovered() {
		t.Fatal("no prompt after 14 quiet days")
	}
	e.Status, e.EndedOn = dbgen.EpisodeStatusRecovered, ptr(time.Date(2026, 9, 5, 0, 0, 0, 0, time.UTC))
	if e.Days() != 5 || e.SuggestRecovered() {
		t.Fatalf("closed episode days = %d", e.Days())
	}
}

func TestRecordFieldRules(t *testing.T) {
	temp := dbgen.RecordTypeTemperature
	f := recordFields{typ: &temp, occurredAt: time.Now(), temperature: ptr(37.85), severity: ptr(int16(3))}
	if err := f.validate(nil); err == nil {
		t.Fatal("severity accepted on a temperature record")
	}

	f.severity = nil
	if err := f.validate(nil); err != nil || *f.temperature != 37.9 {
		t.Fatalf("temperature = %v, %v", *f.temperature, err)
	}

	med := dbgen.RecordTypeMedication
	f = recordFields{typ: &temp, temperature: ptr(38.0), details: RecordDetails{Hospital: "x"}}
	f.typ = &med
	f.clearForType()
	if f.temperature != nil || f.details.Hospital != "" {
		t.Fatalf("clearForType kept %+v", f)
	}

	long := dbgen.EpisodeKindLong
	f = recordFields{occurredAt: time.Now(), isFlare: true}
	if err := f.validate(nil); err == nil {
		t.Fatal("flare accepted outside a long episode")
	}
	if err := f.validate(&long); err != nil {
		t.Fatal(err)
	}
}

func TestBackfilled(t *testing.T) {
	at := time.Date(2026, 9, 24, 21, 0, 0, 0, time.UTC)
	r := RecordView{Record: dbgen.Record{OccurredAt: at, CreatedAt: at.Add(59 * time.Minute)}}
	if r.Backfilled() {
		t.Fatal("59 minutes is not 补录")
	}
	r.CreatedAt = at.Add(61 * time.Minute)
	if !r.Backfilled() {
		t.Fatal("61 minutes is 补录")
	}
}

func TestCursorAndSearchHelpers(t *testing.T) {
	r := dbgen.Record{ID: uuid.New(), OccurredAt: time.Date(2026, 9, 24, 21, 30, 0, 123, time.UTC)}
	ts, id, err := decodeCursor(encodeCursor(r))
	if err != nil || !ts.Equal(r.OccurredAt) || id != r.ID {
		t.Fatalf("cursor round trip: %v %v %v", ts, id, err)
	}
	if _, _, err := decodeCursor("garbage!"); err == nil {
		t.Fatal("bad cursor accepted")
	}
	if got := likePattern(`50%_off\`); got != `%50\%\_off\\%` {
		t.Fatalf("likePattern = %s", got)
	}
	f := recordFields{body: "咳嗽", medName: ptr("止咳糖浆"), details: RecordDetails{Hospital: "儿童医院"}}
	if got := searchText(f, []string{"晚上醒了"}); got != "咳嗽\n晚上醒了\n止咳糖浆\n儿童医院" {
		t.Fatalf("searchText = %q", got)
	}
}
