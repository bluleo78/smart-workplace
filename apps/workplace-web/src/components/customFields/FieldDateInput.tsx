// DATE 타입 위젯 — ISO (YYYY-MM-DD) 문자열만 다룬다. 빈 입력은 null.
// shadcn Popover + Calendar 조합으로 구현하여 이슈 마감일 DatePicker 와 디자인 일관성 유지 (#318).

import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { CalendarIcon, X } from 'lucide-react';
import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { parseValidDateKey } from '@/lib/formatters';

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
  disabled = false,
}: {
  def: IssueFieldDef;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // YYYY-MM-DD 문자열 → Date 객체 변환 (로컬 타임존 기준으로 파싱하여 UTC 오프셋 문제 방지). 해석할 수 없는 값은
  // 화면 전체를 깨뜨리지 않고 「잘못된 날짜」로 보여 지울 수 있게 한다(WP-725).
  const selected = parseValidDateKey(value);
  const invalid = !!value && !selected;

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
            disabled={disabled}
            aria-label={def.name}
            data-testid={`field-input-${def.id}`}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            {selected ? (
              <span>{format(selected, 'yyyy년 M월 d일', { locale: ko })}</span>
            ) : invalid ? (
              <span className="text-destructive" title={value ?? undefined}>
                잘못된 날짜
              </span>
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
      {/* 날짜 지우기 버튼 — 날짜가 설정되어 있고(해석할 수 없는 값 포함) 편집할 수 있을 때만 표시 */}
      {value && !disabled && (
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
