// 이슈 의존성 추가 popover (Phase 4b).
// number 입력 → mutateAsync → 성공 시 close, 실패(사이클 409 등) 시 picker 유지.
// direction prop 으로 blocks/blockedBy 두 모드 재사용.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { DependencyDirection } from '../../../api/issueDependencies';
import { useAddIssueDependency } from '../../../hooks/queries/useIssueDependencies';

export function IssueLinkPicker({
  projectKey,
  issueNumber,
  direction,
}: {
  projectKey: string;
  issueNumber: number;
  direction: DependencyDirection;
}) {
  const add = useAddIssueDependency(projectKey, issueNumber);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  // 저장 — 양의 정수만 통과. 성공 시 close + reset, 실패 시 유지(토스트는 hook).
  async function onSave() {
    const trimmed = value.trim();
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return;
    try {
      await add.mutateAsync({ otherNumber: n, direction });
      setValue('');
      setOpen(false);
    } catch {
      // 에러 토스트는 useAddIssueDependency 가 처리. picker 는 열어둠.
    }
  }

  const label = direction === 'blocks' ? '차단 중 추가' : '차단됨 추가';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={label}
          data-testid={`issue-link-picker-trigger-${direction}`}
        >
          + 추가
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-2 space-y-2"
        data-testid={`issue-link-picker-${direction}`}
      >
        <label
          className="text-sm font-medium"
          htmlFor={`link-picker-input-${direction}`}
        >
          이슈 번호
        </label>
        <Input
          id={`link-picker-input-${direction}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="예: 12"
          type="number"
          min={1}
          data-testid={`issue-link-picker-input-${direction}`}
        />
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              setValue('');
              setOpen(false);
            }}
          >
            취소
          </Button>
          <Button
            size="sm"
            type="button"
            onClick={onSave}
            disabled={add.isPending || !value.trim()}
            data-testid={`issue-link-picker-save-${direction}`}
          >
            추가
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
