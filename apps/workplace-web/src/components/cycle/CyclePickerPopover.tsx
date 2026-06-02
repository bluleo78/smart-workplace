// 이슈 상세에서 사이클을 연결/해제하는 픽커. 닫힐 때 변경된 집합만 PUT.
import { CalendarRange } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useCycles, useIssueCycles, useUpdateIssueCycles } from '../../hooks/queries/useCycles';

export function CyclePickerPopover({
  projectKey,
  issueNumber,
}: {
  projectKey: string;
  issueNumber: number;
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
        {attached.length === 0 && <span className="text-xs text-muted-foreground">없음</span>}
      </div>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" aria-label="사이클 편집" data-testid="cycle-picker-trigger">
            <CalendarRange className="mr-1 h-4 w-4" /> 사이클
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" data-testid="cycle-picker">
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {(cycles.data ?? []).map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-accent"
                data-testid={`cycle-option-${c.id}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                  aria-label={c.name}
                />
                <span className="text-sm">{c.name}</span>
                <span className="ml-auto text-[10px] uppercase text-muted-foreground">
                  {c.status}
                </span>
              </label>
            ))}
            {(cycles.data?.length ?? 0) === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">사이클 없음</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
