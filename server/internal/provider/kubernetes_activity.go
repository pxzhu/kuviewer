package provider

import (
	"context"
	"errors"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"kuviewer/server/internal/topology"
)

var errKubeLogStreamUnavailable = errors.New("logs_stream_unavailable")

func (p KubernetesProvider) ResourceEvents(ctx context.Context, ref ResourceRef) (topology.ResourceEvents, error) {
	if ref.Kind == "" || ref.Name == "" {
		return topology.ResourceEvents{Items: []topology.ResourceEvent{}, Warning: "events_unavailable"}, nil
	}

	events := eventList{}
	selector := url.QueryEscape("involvedObject.kind=" + ref.Kind + ",involvedObject.name=" + ref.Name)
	path := "/api/v1/events?fieldSelector=" + selector
	if ref.Namespace != "" {
		path = "/api/v1/namespaces/" + url.PathEscape(ref.Namespace) + "/events?fieldSelector=" + selector
	}
	found, err := getKubeListJSONStatus(ctx, p.client, path, &events, true)
	if err != nil {
		return topology.ResourceEvents{}, err
	}
	if !found {
		return topology.ResourceEvents{Items: []topology.ResourceEvent{}, Warning: "events_unavailable"}, nil
	}

	items := make([]topology.ResourceEvent, 0, len(events.Items))
	for _, event := range events.Items {
		items = append(items, topology.ResourceEvent{
			Type:      event.Type,
			Reason:    event.Reason,
			Message:   event.Message,
			Source:    eventSource(event),
			Timestamp: eventTimestamp(event),
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].Timestamp > items[j].Timestamp
	})
	return topology.ResourceEvents{Items: items}, nil
}

func (p KubernetesProvider) ResourceLogs(ctx context.Context, ref ResourceRef) (topology.ResourceLogs, error) {
	if ref.Kind != "Pod" || ref.Namespace == "" || ref.Name == "" {
		return topology.ResourceLogs{Lines: []string{}, Warning: "logs_unavailable", TailLines: podLogTailLines}, nil
	}

	found, body, err := p.client.getTextStatus(ctx, podLogPath(ref), true, podLogMaxBytes)
	if err != nil || !found {
		return unavailableResourceLogs(ref), nil
	}

	return topology.ResourceLogs{Lines: cappedLogLines(body), Container: ref.Container, Previous: ref.Previous, TailLines: effectivePodLogTailLines(ref)}, nil
}

func (p KubernetesProvider) StreamLogs(ctx context.Context, ref ResourceRef, onLine func(string) error) error {
	if ref.Kind != "Pod" || ref.Namespace == "" || ref.Name == "" || onLine == nil {
		return errKubeLogStreamUnavailable
	}

	ref.Follow = true
	found, err := p.client.streamText(ctx, podLogPath(ref), true, podLogMaxBytes, func(line string) error {
		return onLine(capLogLine(line))
	})
	if err != nil {
		return err
	}
	if !found {
		return errKubeLogStreamUnavailable
	}
	return nil
}

func unavailableResourceLogs(ref ResourceRef) topology.ResourceLogs {
	return topology.ResourceLogs{Lines: []string{}, Warning: "logs_unavailable", TailLines: effectivePodLogTailLines(ref)}
}

func podLogPath(ref ResourceRef) string {
	return "/api/v1/namespaces/" + url.PathEscape(ref.Namespace) + "/pods/" + url.PathEscape(ref.Name) + "/log?" + podLogQuery(ref).Encode()
}

func podLogQuery(ref ResourceRef) url.Values {
	query := url.Values{}
	query.Set("tailLines", strconv.Itoa(effectivePodLogTailLines(ref)))
	if ref.Container != "" {
		query.Set("container", ref.Container)
	}
	if ref.Previous {
		query.Set("previous", "true")
	}
	if ref.Follow {
		query.Set("follow", "true")
	}
	return query
}

func effectivePodLogTailLines(ref ResourceRef) int {
	if ref.TailLines > 0 && ref.TailLines <= podLogTailLines {
		return ref.TailLines
	}
	return podLogTailLines
}

func cappedLogLines(body string) []string {
	trimmed := strings.TrimSuffix(body, "\n")
	if trimmed == "" {
		return []string{}
	}
	lines := strings.Split(trimmed, "\n")
	if len(lines) > podLogTailLines {
		lines = lines[len(lines)-podLogTailLines:]
	}
	for index, line := range lines {
		lines[index] = capLogLine(line)
	}
	return lines
}

func capLogLine(line string) string {
	if len(line) > podLogMaxLineBytes {
		return line[:podLogMaxLineBytes] + "..."
	}
	return line
}

func eventSource(event eventResource) string {
	if event.ReportingComponent != "" {
		return event.ReportingComponent
	}
	if event.Source.Component != "" && event.Source.Host != "" {
		return event.Source.Component + "@" + event.Source.Host
	}
	if event.Source.Component != "" {
		return event.Source.Component
	}
	return event.Source.Host
}

func eventTimestamp(event eventResource) string {
	for _, value := range []string{event.EventTime, event.LastTimestamp, event.FirstTimestamp, event.Metadata.CreationTimestamp} {
		if value != "" {
			return value
		}
	}
	return ""
}
