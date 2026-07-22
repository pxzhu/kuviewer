import { useState, type KeyboardEvent } from 'react';
import { Button } from '@heroui/react/button';
import { Popover } from '@heroui/react/popover';
import { Check, ChevronDown } from 'lucide-react';

export interface KuSelectOption<Value extends string = string> {
  disabled?: boolean;
  value: Value;
  label: string;
}

interface KuSelectProps<Value extends string> {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  options: ReadonlyArray<KuSelectOption<Value>>;
  testId?: string;
  value: Value;
  onChange: (value: Value) => void;
}

export function KuSelect<Value extends string>({
  ariaLabel,
  className = '',
  disabled = false,
  options,
  testId,
  value,
  onChange,
}: KuSelectProps<Value>) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`ku-select-trigger ${className}`.trim()}
        data-testid={testId}
        data-selected-value={selectedOption?.value ?? ''}
        isDisabled={disabled || options.length === 0}
        variant="secondary"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate text-left">{selectedOption?.label ?? '선택 항목 없음'}</span>
        <ChevronDown className="ku-select-indicator" data-open={isOpen || undefined} size={16} aria-hidden="true" />
      </Button>
      <Popover.Content className="ku-select-popover" placement="bottom start">
        <Popover.Dialog aria-label={`${ariaLabel} 선택`} className="outline-none">
          <div
            className="ku-select-listbox"
            data-slot="list-box"
            role="listbox"
            aria-label={`${ariaLabel} 선택`}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setIsOpen(false);
              }
            }}
          >
            {options.map((option) => {
              const selected = option.value === selectedOption?.value;
              return (
                <button
                  key={option.value}
                  aria-disabled={option.disabled || undefined}
                  aria-selected={selected}
                  autoFocus={selected && !option.disabled}
                  className={`ku-select-option ${selected ? 'ku-select-option-selected' : ''}`}
                  data-ku-select-value={option.value}
                  disabled={option.disabled}
                  role="option"
                  type="button"
                  onKeyDown={handleOptionKeyDown}
                  onClick={() => {
                    if (!option.disabled) {
                      onChange(option.value);
                      setIsOpen(false);
                    }
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
                  <Check className="ku-select-check" size={15} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const listbox = event.currentTarget.closest('[role="listbox"]');
  const optionElements = Array.from(listbox?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
  const currentIndex = optionElements.indexOf(event.currentTarget);
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? optionElements.length - 1
      : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + optionElements.length) % optionElements.length;
  optionElements[nextIndex]?.focus();
}
