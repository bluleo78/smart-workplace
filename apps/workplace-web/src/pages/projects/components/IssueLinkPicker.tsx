// 이슈 의존성 추가 popover (Phase 4b).
// number 입력 → mutateAsync → 성공 시 close, 실패(사이클 409 등) 시 picker 유지.
// direction prop 으로 blocks/blockedBy 두 모드 재사용.

import { useState } from 'react';
import { toast } from 'sonner';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { DependencyDirection } from '../../../api/issueDependencies';
import { useAddIssueDependency } from '../../../hooks/queries/useIssueDependencies';

/** 이슈 번호 상한 — 서버가 int 로 받는다. */
const MAX_ISSUE_NUMBER = 2_147_483_647;

export function IssueLinkPicker({
  projectKey,
  issueNumber,
  direction,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  direction: DependencyDirection;
  /** 워크플로 편집 권한 없음(OPEN 비멤버) — 서버가 멤버만 허용한다(WP-503). */
  disabled?: boolean;
}) {
  const add = useAddIssueDependency(projectKey, issueNumber);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  // 저장 — 양의 정수만 통과. 성공 시 close + reset, 실패 시 유지(토스트는 hook).
  async function onSave() {
    const trimmed = value.trim();
    const n = Number(trimmed);
    // 0·음수·소수는 보낼 수 없다 — 예전엔 조용히 return 해 창만 그대로 남았다(WP-618). 이유를 알린다.
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      toast.error('이슈 번호는 1 이상의 정수로 입력해 주세요');
      return;
    }
    // 서버 번호 범위(int)를 넘으면 요청 본문을 읽지 못해 「요청 본문을 해석할 수 없습니다」가 떴다(WP-470) — 보내기 전에 화면 문구로 알린다.
    if (n > MAX_ISSUE_NUMBER) {
      toast.error('이 프로젝트에 없는 이슈 번호입니다');
      return;
    }
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
          disabled={disabled}
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
