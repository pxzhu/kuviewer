import { Input, type InputProps } from '@heroui/react/input';

export interface KuInputProps extends Omit<InputProps, 'className' | 'fullWidth' | 'variant'> {
  className?: string;
}

export function KuInput({ className = '', ...props }: KuInputProps) {
  return <Input {...props} className={`ku-field ${className}`.trim()} fullWidth variant="secondary" />;
}
