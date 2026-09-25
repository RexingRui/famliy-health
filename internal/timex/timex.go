// Package timex fixes business time to Asia/Shanghai regardless of the server's zone.
// Day grouping, calendars, "today" and episode day counts all go through here.
package timex

import (
	"log/slog"
	"time"
)

const Zone = "Asia/Shanghai"

var Loc = load()

func load() *time.Location {
	loc, err := time.LoadLocation(Zone)
	if err != nil {
		slog.Warn("load time zone failed, falling back to fixed +08:00", "zone", Zone, "err", err)
		return time.FixedZone("CST", 8*3600)
	}
	return loc
}

// Now is overridable in tests.
var Now = func() time.Time { return time.Now().In(Loc) }

func In(t time.Time) time.Time { return t.In(Loc) }

// Date returns midnight of t's calendar day in Loc.
func Date(t time.Time) time.Time {
	t = t.In(Loc)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, Loc)
}

func Today() time.Time { return Date(Now()) }

// DateOf interprets a date-only value (as decoded from JSON/DB, any zone) as that calendar day in Loc.
func DateOf(d time.Time) time.Time {
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, Loc)
}

// DaysBetween counts calendar days from a to b (b - a), both date-only.
func DaysBetween(a, b time.Time) int {
	a, b = DateOf(a), DateOf(b)
	return int(b.Sub(a).Hours()/24 + 0.5)
}

// ParseMonth parses "2026-09" into [first day, first day of next month).
func ParseMonth(s string) (from, to time.Time, err error) {
	t, err := time.ParseInLocation("2006-01", s, Loc)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return t, t.AddDate(0, 1, 0), nil
}

// WeekOf returns Monday 00:00 and next Monday 00:00 of the week containing t.
func WeekOf(t time.Time) (from, to time.Time) {
	d := Date(t)
	offset := (int(d.Weekday()) + 6) % 7
	from = d.AddDate(0, 0, -offset)
	return from, from.AddDate(0, 0, 7)
}

// EndOfDay returns the last representable instant of date d (inclusive upper bound).
func EndOfDay(d time.Time) time.Time {
	return DateOf(d).AddDate(0, 0, 1).Add(-time.Microsecond)
}
