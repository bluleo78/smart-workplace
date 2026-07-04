// 이슈 상세에서 마일스톤을 연결/해제하는 픽커. CyclePickerPopover 사용성 미러이나
// 마일스톤은 이슈당 1개(단일 선택)이므로 클릭 즉시 onChange 호출 + 팝오버 닫힘.

import { Flag } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useMilestones } from '../../../hooks/queries/useMilestones';

interface MilestonePickerPopoverProps {
  projectKey: string;
  /** 현재 연결된 마일스톤 id, 없으면 null */
  value: number | null;
  disabled?: boolean;
  /** 마일스톤 선택 시 id, 해제 시 null 반환 */
  onChange: (milestoneId: number | null) => void;
}

export function MilestonePickerPopover({
  projectKey,
  value,
  disabled,
  onChange,
}: MilestonePickerPopoverProps) {
  const milestones = useMilestones(projectKey);
  const [open, setOpen] = useState(false);

  const current = (milestones.data ?? []).find((m) => m.id === value) ?? null;

  function handleSelect(id: number | null) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div data-testid="milestone-picker">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label="마일스톤 선택"
            data-testid="milestone-picker-trigger"
            className="w-full justify-start gap-2 font-normal"
          >
            <Flag className="h-4 w-4 shrink-0 text-muted-foreground" />
            {current ? <span>{current.name}</span> : <span className="text-muted-foreground">없음</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" data-testid="milestone-picker-popover">
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {/* 선택 해제 옵션 — 항상 최상단 노출 */}
            <button
              type="button"
              className="flex w-full cursor-pointer items-center rounded p-1 text-left text-sm text-muted-foreground hover:bg-accent"
              onClick={() => handleSelect(null)}
              data-testid="milestone-option-clear"
            >
              없음
            </button>
            {(milestones.data ?? []).map((m) => (
              <button
                key={m.id}
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 rounded p-1 text-left hover:bg-accent"
                onClick={() => handleSelect(m.id)}
                data-testid={`milestone-option-${m.id}`}
                aria-pressed={m.id === value}
              >
                <span className="text-sm">{m.name}</span>
              </button>
            ))}
            {(milestones.data?.length ?? 0) === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">마일스톤 없음</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
