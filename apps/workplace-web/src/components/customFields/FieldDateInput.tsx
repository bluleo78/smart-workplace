// DATE 타입 위젯 — ISO (YYYY-MM-DD) 문자열만 다룬다. 빈 입력은 null.
// shadcn Popover + Calendar 조합으로 구현하여 이슈 마감일 DatePicker 와 디자인 일관성 유지 (#318).

import { format, parse } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { IssueFieldDef } from '../../types/customField';

/**
 * 커스텀 DATE 필드 입력 컴포넌트.
 * native <input type="date"> 대신 shadcn Popover + Calendar 패턴을 사용하여
 * 이슈 상세 패널의 마감일 DatePicker 와 시각적으로 일관성을 유지한다.
 */
export function FieldDateInput({
  def,
  value,
  onChange,
}: {
  def: IssueFieldDef;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  // YYYY-MM-DD 문자열 → Date 객체 변환 (로컬 타임존 기준으로 파싱하여 UTC 오프셋 문제 방지)
  const selected = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined;

  function handleSelect(date: Date | undefined) {
    if (date) {
      onChange(format(date, 'yyyy-MM-dd'));
    }
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    // onChange 계약: string | null — 빈 값은 null (DueDatePickerPopover 의 undefined 와 다름)
    onChange(null);
  }

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 justify-start gap-2 font-normal"
            aria-label={def.name}
            data-testid={`field-input-${def.id}`}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            {selected ? (
              <span>{format(selected, 'yyyy년 M월 d일', { locale: ko })}</span>
            ) : (
              <span className="text-muted-foreground">날짜 선택</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={handleSelect}
          />
        </PopoverContent>
      </Popover>
      {/* 날짜 지우기 버튼 — 날짜가 설정된 경우에만 표시 */}
      {selected && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleClear}
          aria-label={`${def.name} 지우기`}
          data-testid={`field-input-${def.id}-clear`}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
