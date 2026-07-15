package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"kuviewer/server/internal/httpapi"
	"kuviewer/server/internal/provider"
)

func main() {
	addr := envOrDefault("KUVIEWER_LISTEN_ADDR", "127.0.0.1:8080")
	adminToken := adminTokenFor(addr)
	corsOrigin := os.Getenv("KUVIEWER_CORS_ORIGIN")
	source := envOrDefault("KUVIEWER_SOURCE", "mock")
	staticDir := os.Getenv("KUVIEWER_STATIC_DIR")
	resourceViewsFile := os.Getenv("KUVIEWER_RESOURCE_VIEWS_FILE")

	snapshotProvider, err := provider.New(source)
	if err != nil {
		log.Fatal(err)
	}
	server := httpapi.NewServerWithConfig(snapshotProvider, httpapi.ServerConfig{
		AdminToken:        adminToken,
		CORSOrigin:        corsOrigin,
		StaticDir:         staticDir,
		Source:            source,
		ResourceViewsFile: resourceViewsFile,
		SnapshotCacheTTL:  snapshotCacheTTLFromEnv(),
	})

	log.Printf("kuviewer server listening on %s source=%s", addr, source)

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           server,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func snapshotCacheTTLFromEnv() time.Duration {
	raw := os.Getenv("KUVIEWER_SNAPSHOT_CACHE_TTL")
	if raw == "" {
		return 10 * time.Second
	}
	if raw == "off" || raw == "disabled" {
		return -1
	}
	ttl, err := time.ParseDuration(raw)
	if err != nil || ttl < 0 {
		log.Fatalf("KUVIEWER_SNAPSHOT_CACHE_TTL must be a duration, 0, off, or disabled")
	}
	if ttl == 0 {
		return -1
	}
	return ttl
}

func adminTokenFor(addr string) string {
	adminToken := os.Getenv("KUVIEWER_ADMIN_TOKEN")
	if adminToken != "" {
		return adminToken
	}

	if isLoopbackListenAddr(addr) {
		log.Print("using default admin token for local development")
		return "kuviewer-admin"
	}

	log.Fatal("KUVIEWER_ADMIN_TOKEN is required when KUVIEWER_LISTEN_ADDR is not loopback")
	return ""
}

func isLoopbackListenAddr(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func envOrDefault(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
