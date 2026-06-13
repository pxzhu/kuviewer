package main

import (
	"log"
	"net/http"
	"os"

	"kuviewer/server/internal/httpapi"
	"kuviewer/server/internal/provider"
)

func main() {
	addr := envOrDefault("KUVIEWER_LISTEN_ADDR", "127.0.0.1:8080")
	adminToken := envOrDefault("KUVIEWER_ADMIN_TOKEN", "kuviewer-admin")
	corsOrigin := os.Getenv("KUVIEWER_CORS_ORIGIN")
	source := envOrDefault("KUVIEWER_SOURCE", "mock")
	staticDir := os.Getenv("KUVIEWER_STATIC_DIR")

	snapshotProvider, err := provider.New(source)
	if err != nil {
		log.Fatal(err)
	}
	server := httpapi.NewServerWithConfig(snapshotProvider, httpapi.ServerConfig{
		AdminToken: adminToken,
		CORSOrigin: corsOrigin,
		StaticDir:  staticDir,
		Source:     source,
	})

	log.Printf("kuviewer server listening on %s source=%s", addr, source)
	if adminToken == "kuviewer-admin" {
		log.Print("using default admin token for local development")
	}

	if err := http.ListenAndServe(addr, server); err != nil {
		log.Fatal(err)
	}
}

func envOrDefault(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
