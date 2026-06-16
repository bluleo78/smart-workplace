// 이슈 마감일 DatePicker — shadcn Popover + Calendar 조합.
// 무엇을: native <input type="date"> 대신 shadcn 디자인 시스템 컴포넌트로 날짜 선택 UI를 제공.
// 왜: 나머지 필드(상태/우선순위/담당자/라벨)가 모두 shadcn 컴포넌트를 쓰는 것과 일관성 유지 (#284).

import { format, parse } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DueDatePickerPopoverProps {
  /** YYYY-MM-DD 형식 또는 null (미설정) */
  value: string | null;
  /** 날짜 선택 시 YYYY-MM-DD 문자열을 반환. 지우기 시 undefined를 반환. */
  onChange: (date: string | undefined) => void;
  disabled?: boolean;
}

/**
 * 이슈 상세 패널의 마감일 DatePicker 컴포넌트.
 * Popover + Calendar 패턴으로 구현하여 shadcn 디자인 시스템과 일관성을 유지한다.
 */
export function DueDatePickerPopover({ value, onChange, disabled }: DueDatePickerPopoverProps) {
  const [open, setOpen] = useState(false);

  // YYYY-MM-DD 문자열 → Date 객체 변환 (로컬 타임존 기준으로 파싱)
  const selected = value
    ? parse(value, 'yyyy-MM-dd', new Date())
    : undefined;

  function handleSelect(date: Date | undefined) {
    if (date) {
      onChange(format(date, 'yyyy-MM-dd'));
    }
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(undefined);
  }

  return (
    <div className="flex items-center gap-1" data-testid="due-date-picker">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 justify-start gap-2 font-normal"
            disabled={disabled}
            aria-label="마감일 선택"
            data-testid="due-date-trigger"
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            {selected ? (
              <span>{format(selected, 'yyyy년 M월 d일', { locale: ko })}</span>
            ) : (
              <span className="text-muted-foreground">없음</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" data-testid="due-date-popover">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={handleSelect}
          />
        </PopoverContent>
      </Popover>
      {/* 마감일 지우기 버튼 — 날짜가 설정된 경우에만 표시 */}
      {selected && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleClear}
          disabled={disabled}
          aria-label="마감일 지우기"
          data-testid="due-date-clear"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
