package ratelimit

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Limiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
	max      int
	window   time.Duration
}

func New(max int, window time.Duration) *Limiter {
	l := &Limiter{
		attempts: make(map[string][]time.Time),
		max:      max,
		window:   window,
	}
	go l.cleanupLoop()
	return l
}

func (l *Limiter) cleanupLoop() {
	ticker := time.NewTicker(l.window)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-l.window)
		l.mu.Lock()
		for key, ts := range l.attempts {
			i := 0
			for i < len(ts) && ts[i].Before(cutoff) {
				i++
			}
			if i == len(ts) {
				delete(l.attempts, key)
			} else if i > 0 {
				l.attempts[key] = ts[i:]
			}
		}
		l.mu.Unlock()
	}
}

func (l *Limiter) IsLimited(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune(key)
	return len(l.attempts[key]) >= l.max
}

func (l *Limiter) RecordFailure(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.attempts[key] = append(l.attempts[key], time.Now())
}

func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, key)
}

func (l *Limiter) prune(key string) {
	cutoff := time.Now().Add(-l.window)
	ts := l.attempts[key]
	i := 0
	for i < len(ts) && ts[i].Before(cutoff) {
		i++
	}
	if i == len(ts) {
		delete(l.attempts, key)
	} else if i > 0 {
		l.attempts[key] = ts[i:]
	}
}

// Allow records the request and returns true if it is within the rate limit.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune(key)
	if len(l.attempts[key]) >= l.max {
		return false
	}
	l.attempts[key] = append(l.attempts[key], time.Now())
	return true
}

func Key(r *http.Request, username string) string {
	return normalizeIP(r) + ":" + strings.ToLower(username)
}

func IPKey(r *http.Request) string {
	return normalizeIP(r)
}

// normalizeIP returns a rate-limit key from the request's remote address.
// IPv6 addresses are masked to /64 so that rotating within the same prefix
// does not bypass per-IP limits.
func normalizeIP(r *http.Request) string {
	addr := r.RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		addr = host
	}
	ip := net.ParseIP(addr)
	if ip == nil {
		return strings.ToLower(addr)
	}
	if ip.To4() != nil {
		return ip.String()
	}
	// IPv6: mask to /64 (standard end-user prefix size).
	masked := ip.Mask(net.CIDRMask(64, 128))
	return masked.String()
}
