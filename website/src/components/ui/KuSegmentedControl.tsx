import type { LucideIcon } from 'lucide-react';
import { Button } from '@heroui/react/button';

export interface KuSegmentedOption<Value extends string> {
  value: Value;
  label: string;
  icon?: LucideIcon;
  testId?: string;
}

interface KuSegmentedControlProps<Value extends string> {
  ariaLabel: string;
  className?: string;
  value: Value;
  options: ReadonlyArray<KuSegmentedOption<Value>>;
  onChange: (value: Value) => void;
}

export function KuSegmentedControl<Value extends string>({
  ariaLabel,
  className = '',
  value,
  options,
  onChange,
}: KuSegmentedControlProps<Value>) {
  return (
    <div className={`ku-segmented ${className}`.trim()} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const Icon = option.icon;
        const selected = option.value === value;
        return (
          <Button
            key={option.value}
            className={`ku-segmented-button ${selected ? 'ku-segmented-button-active' : ''}`}
            data-testid={option.testId}
            aria-pressed={selected}
            size="sm"
            variant={selected ? 'primary' : 'ghost'}
            onPress={() => onChange(option.value)}
          >
            {Icon ? <Icon className="shrink-0" size={15} aria-hidden="true" /> : null}
            <span className="truncate">{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
