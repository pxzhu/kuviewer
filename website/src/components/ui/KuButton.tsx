import { Button, type ButtonProps } from '@heroui/react/button';

export type KuButtonTone = 'default' | 'primary';

export interface KuButtonProps extends Omit<ButtonProps, 'className' | 'isDisabled' | 'size' | 'variant'> {
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tone?: KuButtonTone;
  title?: string;
}

export function KuButton({ className = '', disabled, size = 'md', tone = 'default', ...props }: KuButtonProps) {
  return (
    <Button
      {...props}
      className={`${tone === 'primary' ? 'ku-control-primary' : 'ku-control'} ${className}`.trim()}
      isDisabled={disabled}
      size={size}
      variant={tone === 'primary' ? 'primary' : 'outline'}
    />
  );
}
