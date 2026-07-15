package httpapi

import (
	"context"
	"sync"
	"time"

	"kuviewer/server/internal/topology"
)

const defaultSnapshotCacheTTL = 10 * time.Second
const snapshotCollectionTimeout = 25 * time.Second

type snapshotCacheInfo struct {
	Status   string
	CachedAt time.Time
}

type snapshotLoad struct {
	done     chan struct{}
	snapshot topology.Snapshot
	err      error
	cachedAt time.Time
}

type snapshotCache struct {
	mu       sync.Mutex
	ttl      time.Duration
	snapshot topology.Snapshot
	cachedAt time.Time
	hasValue bool
	inFlight *snapshotLoad
}

func newSnapshotCache(ttl time.Duration) *snapshotCache {
	if ttl == 0 {
		ttl = defaultSnapshotCacheTTL
	}
	return &snapshotCache{ttl: ttl}
}

func (c *snapshotCache) get(ctx context.Context, force bool, load func(context.Context) (topology.Snapshot, error)) (topology.Snapshot, snapshotCacheInfo, error) {
	if c.ttl < 0 {
		snapshot, err := load(ctx)
		return snapshot, snapshotCacheInfo{Status: "disabled"}, err
	}

	now := time.Now()
	c.mu.Lock()
	if !force && c.hasValue && now.Sub(c.cachedAt) < c.ttl {
		snapshot := c.snapshot
		cachedAt := c.cachedAt
		c.mu.Unlock()
		return snapshot, snapshotCacheInfo{Status: "hit", CachedAt: cachedAt}, nil
	}
	if c.inFlight != nil {
		inFlight := c.inFlight
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return topology.Snapshot{}, snapshotCacheInfo{Status: "shared"}, ctx.Err()
		case <-inFlight.done:
			return inFlight.snapshot, snapshotCacheInfo{Status: "shared", CachedAt: inFlight.cachedAt}, inFlight.err
		}
	}

	inFlight := &snapshotLoad{done: make(chan struct{})}
	c.inFlight = inFlight
	c.mu.Unlock()

	loadContext, cancelLoad := context.WithTimeout(context.Background(), snapshotCollectionTimeout)
	defer cancelLoad()
	snapshot, err := load(loadContext)
	c.mu.Lock()
	if err == nil {
		c.snapshot = snapshot
		c.cachedAt = time.Now()
		c.hasValue = true
		inFlight.cachedAt = c.cachedAt
	}
	inFlight.snapshot = snapshot
	inFlight.err = err
	c.inFlight = nil
	close(inFlight.done)
	c.mu.Unlock()

	return snapshot, snapshotCacheInfo{Status: "miss", CachedAt: inFlight.cachedAt}, err
}
