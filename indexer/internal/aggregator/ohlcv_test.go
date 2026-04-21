package aggregator

import (
	"testing"
	"time"
)

// Floor must return Monday 00:00 UTC of the ISO week. Friday 2026-04-10 sits in
// the week beginning Monday 2026-04-06.
func TestBucketFloor_Week(t *testing.T) {
	var weekly bucketSpec
	for _, b := range Buckets {
		if b.name == "1w" {
			weekly = b
			break
		}
	}
	if weekly.name == "" {
		t.Fatal("1w bucket spec missing")
	}
	got := weekly.Floor(time.Date(2026, 4, 10, 12, 34, 56, 0, time.UTC))
	want := time.Date(2026, 4, 6, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("Floor(Friday) = %s, want %s", got, want)
	}
	// And Monday itself should round-trip to itself.
	got2 := weekly.Floor(want)
	if !got2.Equal(want) {
		t.Fatalf("Floor(Monday) = %s, want %s", got2, want)
	}
}

func TestBucketFloor_Day(t *testing.T) {
	var daily bucketSpec
	for _, b := range Buckets {
		if b.name == "1d" {
			daily = b
			break
		}
	}
	got := daily.Floor(time.Date(2026, 4, 8, 23, 59, 59, 0, time.UTC))
	want := time.Date(2026, 4, 8, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("Floor(day) = %s, want %s", got, want)
	}
}

func TestBucketFloor_FiveMin(t *testing.T) {
	var five bucketSpec
	for _, b := range Buckets {
		if b.name == "5m" {
			five = b
			break
		}
	}
	got := five.Floor(time.Date(2026, 4, 8, 12, 7, 30, 0, time.UTC))
	want := time.Date(2026, 4, 8, 12, 5, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("Floor(5m) = %s, want %s", got, want)
	}
}
