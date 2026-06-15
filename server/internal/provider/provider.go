package provider

import (
	"context"
	"errors"
	"fmt"

	"kuviewer/server/internal/topology"
)

var ErrProviderNotImplemented = errors.New("provider not implemented")

type TopologyProvider interface {
	Snapshot(ctx context.Context) (topology.Snapshot, error)
}

type ResourceRef struct {
	Kind      string
	Namespace string
	Name      string
	Container string
}

type EventProvider interface {
	ResourceEvents(ctx context.Context, ref ResourceRef) (topology.ResourceEvents, error)
}

type LogProvider interface {
	ResourceLogs(ctx context.Context, ref ResourceRef) (topology.ResourceLogs, error)
}

func New(source string) (TopologyProvider, error) {
	if source == "kubernetes" {
		return NewKubernetesProviderFromEnv()
	}

	if source != "" && source != "mock" {
		return nil, fmt.Errorf("unknown provider source %q", source)
	}

	return MockProvider{}, nil
}
