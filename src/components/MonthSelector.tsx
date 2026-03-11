'use client';

import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonthKey } from '@/lib/types';

interface MonthSelectorProps {
  value: string;
  onChange: (month: string) => void;
}

export function MonthSelector({ value, onChange }: MonthSelectorProps) {
  function navigate(direction: -1 | 1) {
    const [year, month] = value.split('-').map(Number);
    const date = new Date(year, month - 1 + direction, 1);
    const newKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    onChange(newKey);
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-8 w-8 rounded-full">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[130px] text-center text-sm font-semibold">
        {formatMonthKey(value)}
      </span>
      <Button variant="ghost" size="icon" onClick={() => navigate(1)} className="h-8 w-8 rounded-full">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
