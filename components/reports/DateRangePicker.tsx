'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DateRangePickerProps {
  value: number;
  onChange: (days: number) => void;
}

const presets = [
  { label: '7 Days', value: 7 },
  { label: '30 Days', value: 30 },
  { label: '90 Days', value: 90 },
  { label: '1 Year', value: 365 },
];

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-2">
      {presets.map((preset) => (
        <Button
          key={preset.value}
          variant="ghost"
          size="sm"
          onClick={() => onChange(preset.value)}
          className={cn(
            'text-sm transition-colors',
            value === preset.value
              ? 'bg-blue-600/10 text-blue-500 hover:bg-blue-600/20 hover:text-blue-400'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          )}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}
