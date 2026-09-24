package timex

import (
	"testing"
	"time"
)

func TestWeekOf(t *testing.T) {
	thu := time.Date(2026, 9, 24, 21, 30, 0, 0, Loc)
	from, to := WeekOf(thu)
	if from.Format("2006-01-02") != "2026-09-21" || to.Format("2006-01-02") != "2026-09-28" {
		t.Fatalf("week = %s..%s", from, to)
	}
	sun := time.Date(2026, 9, 27, 23, 0, 0, 0, Loc)
	if from2, _ := WeekOf(sun); !from2.Equal(from) {
		t.Fatalf("sunday belongs to week starting %s", from2)
	}
}

func TestDateUsesShanghai(t *testing.T) {
	utc := time.Date(2026, 9, 24, 17, 0, 0, 0, time.UTC) // 01:00 on the 25th in Shanghai
	if got := Date(utc).Format("2006-01-02"); got != "2026-09-25" {
		t.Fatalf("Date = %s", got)
	}
}

func TestDaysBetweenAcrossMonths(t *testing.T) {
	a := time.Date(2026, 8, 30, 0, 0, 0, 0, time.UTC)
	b := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)
	if got := DaysBetween(a, b); got != 3 {
		t.Fatalf("DaysBetween = %d", got)
	}
}

func TestParseMonth(t *testing.T) {
	from, to, err := ParseMonth("2026-12")
	if err != nil || from.Format("2006-01-02") != "2026-12-01" || to.Format("2006-01-02") != "2027-01-01" {
		t.Fatalf("ParseMonth = %s %s %v", from, to, err)
	}
	if _, _, err := ParseMonth("2026-13"); err == nil {
		t.Fatal("expected error")
	}
}
