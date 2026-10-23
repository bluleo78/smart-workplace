// 이슈 상세에서 사이클을 연결/해제하는 픽커. 닫힐 때 변경된 집합만 PUT.
import { CalendarRange } from 'lucide-react';
import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';

import { useCycles, useIssueCycles, useUpdateIssueCycles } from '../../hooks/queries/useCycles';
import { canPickCycle } from '../../lib/cycleMeta';
import { labelWithValue } from '../../lib/labelWithValue';
import { cn } from '../../lib/utils';
import { CYCLE_STATUS_LABEL } from '../../types/cycle';

export function CyclePickerPopover({
  projectKey,
  issueNumber,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  /** 워크플로 편집 권한이 없으면 트리거를 비활성(WP-481 — OPEN 비멤버가 골라도 저장 403 이었다). */
  disabled?: boolean;
}) {
  const cycles = useCycles(projectKey);
  const current = useIssueCycles(projectKey, issueNumber);
  const update = useUpdateIssueCycles(projectKey, issueNumber);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function onOpenChange(next: boolean) {
    if (next) {
      setSelected((current.data ?? []).map((c) => c.id));
    } else {
      const before = (current.data ?? []).map((c) => c.id).sort((a, b) => a - b).join(',');
      const after = [...selected].sort((a, b) => a - b).join(',');
      if (before !== after) update.mutate(selected);
    }
    setOpen(next);
  }

  const attached = current.data ?? [];
  // 완료 사이클은 이미 붙어 있을 때만 고를 수 있다(새로 붙이면 서버가 거절 — WP-659).
  const attachedIds = new Set(attached.map((c) => c.id));

  return (
    <div data-testid="issue-cycles">
      <div className="mb-1 flex flex-wrap gap-1">
        {attached.map((c) => (
          <span
            key={c.id}
            className="rounded bg-muted px-1.5 py-0.5 text-xs"
            data-testid={`issue-cycle-chip-${c.id}`}
          >
            {c.name}
          </span>
        ))}
      </div>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            // 붙은 사이클은 버튼 밖 칩으로 보이지만 이름에도 넣어 지금 값을 함께 읽힌다(WP-853). 없으면 「사이클 편집」만.
            aria-label={labelWithValue('사이클 편집', attached.map((c) => c.name).join(', '))}
            data-testid="cycle-picker-trigger"
            disabled={disabled}
            className="w-full justify-start gap-2 font-normal"
          >
            <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" /> 사이클
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" data-testid="cycle-picker">
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {(cycles.data ?? []).map((c) => {
              const pickable = canPickCycle(c, attachedIds);
              return (
              <label
                key={c.id}
                className={cn(
                  'flex items-center gap-2 rounded p-1',
                  pickable ? 'cursor-pointer hover:bg-accent' : 'cursor-not-allowed opacity-50',
                )}
                title={pickable ? undefined : '완료된 사이클에는 이슈를 추가할 수 없습니다'}
                data-testid={`cycle-option-${c.id}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  disabled={!pickable}
                  onChange={() => toggle(c.id)}
                  aria-label={c.name}
                />
                <span className="text-sm">{c.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {CYCLE_STATUS_LABEL[c.status] ?? c.status}
                </span>
              </label>
              );
            })}
            {(cycles.data?.length ?? 0) === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">사이클 없음</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
