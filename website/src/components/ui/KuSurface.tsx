import { Chip, type ChipProps } from '@heroui/react/chip';
import { Surface, type SurfaceProps } from '@heroui/react/surface';

export interface KuSurfaceProps extends Omit<SurfaceProps, 'className' | 'variant'> {
  'aria-label'?: string;
  className?: string;
  muted?: boolean;
  role?: string;
}

export function KuSurface({ className = '', muted = false, ...props }: KuSurfaceProps) {
  return (
    <Surface
      {...props}
      className={`${muted ? 'ku-panel-muted' : 'ku-panel'} ${className}`.trim()}
      variant={muted ? 'secondary' : 'default'}
    />
  );
}

export interface KuChipProps extends Omit<ChipProps, 'className' | 'size' | 'variant'> {
  className?: string;
  title?: string;
}

export function KuChip({ className = '', ...props }: KuChipProps) {
  return <Chip {...props} className={`ku-chip ${className}`.trim()} size="sm" variant="soft" />;
}
