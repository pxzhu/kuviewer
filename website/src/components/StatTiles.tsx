import { Activity, Boxes, CircleAlert, Server } from 'lucide-react';
import type { ClusterSummary } from '../types/topology';

interface StatTilesProps {
  clusters: ClusterSummary[];
  selectedClusterId: string;
}

export function StatTiles({ clusters, selectedClusterId }: StatTilesProps) {
  const selectedCluster = selectedClusterId === 'all' ? undefined : clusters.find((cluster) => cluster.id === selectedClusterId);
  const summary = selectedCluster || aggregateClusters(clusters);
  const stats = [
    {
      label: 'Cluster',
      value: selectedCluster ? selectedCluster.name : String(clusters.length),
      detail: selectedCluster ? `${selectedCluster.provider} ${selectedCluster.version}` : `Namespace ${summary.namespaces}개`,
      icon: Boxes,
      accent: '#007aff',
    },
    {
      label: 'Node',
      value: `${summary.nodeReady}/${summary.nodeTotal}`,
      detail: 'Ready 상태 Node',
      icon: Server,
      accent: '#34c759',
    },
    {
      label: 'Pod',
      value: String(summary.podRunning),
      detail: 'Running 상태 Pod',
      icon: Activity,
      accent: '#5856d6',
    },
    {
      label: '경고',
      value: String(summary.podWarning),
      detail: '주의 필요 Pod',
      icon: CircleAlert,
      accent: '#ff9500',
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;

        return (
          <article key={stat.label} className="ku-panel overflow-hidden p-4 transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="ku-meta">{stat.label}</p>
                <p className="ku-metric mt-2 truncate text-[26px] font-semibold leading-none tracking-[0] text-[#1d1d1f]">{stat.value}</p>
                <p className="ku-copy mt-2 text-sm font-medium">{stat.detail}</p>
              </div>
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_2px_10px_rgba(0,0,0,0.04)]"
                style={{ borderColor: `${stat.accent}26`, color: stat.accent, backgroundColor: `${stat.accent}10` }}
              >
                <Icon size={19} aria-hidden="true" />
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function aggregateClusters(clusters: ClusterSummary[]): ClusterSummary {
  if (clusters.length === 0) {
    return {
      id: 'none',
      name: '0',
      provider: 'Kubernetes',
      version: '-',
      nodeReady: 0,
      nodeTotal: 0,
      podRunning: 0,
      podWarning: 0,
      namespaces: 0,
    };
  }

  return clusters.reduce<ClusterSummary>(
    (next, cluster) => ({
      ...next,
      nodeReady: next.nodeReady + cluster.nodeReady,
      nodeTotal: next.nodeTotal + cluster.nodeTotal,
      podRunning: next.podRunning + cluster.podRunning,
      podWarning: next.podWarning + cluster.podWarning,
      namespaces: next.namespaces + cluster.namespaces,
    }),
    {
      id: 'all',
      name: String(clusters.length),
      provider: 'Kubernetes',
      version: 'mixed',
      nodeReady: 0,
      nodeTotal: 0,
      podRunning: 0,
      podWarning: 0,
      namespaces: 0,
    },
  );
}
