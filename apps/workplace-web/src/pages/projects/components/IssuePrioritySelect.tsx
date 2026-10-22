// 이슈 우선순위 인라인 변경 select. shadcn/Radix Select 사용.

import { useRef } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select';
import { useRestoreFocusAfterPick } from '@/hooks/useRestoreFocusOnExit';

import type { IssuePriority } from '../../../types/issue';

const OPTIONS: { value: IssuePriority; label: string }[] = [
  { value: 'LOW', label: '낮음' },
  { value: 'MID', label: '보통' },
  { value: 'HIGH', label: '높음' },
];

// 우선순위 변경 시 onChange 콜백으로 상위에 위임 — 인라인 patch 호출에 사용.
export function IssuePrioritySelect({
  value,
  onChange,
  disabled,
}: {
  value: IssuePriority;
  onChange: (v: IssuePriority) => void;
  disabled?: boolean;
}) {
  // 값을 고르면 저장 중 잠금(disabled)으로 트리거가 포커스를 잃어 body 로 빠졌다 — 풀리면 트리거로 돌린다(WP-813).
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const markPicked = useRestoreFocusAfterPick(disabled ?? false, triggerRef);
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        markPicked();
        onChange(v as IssuePriority);
      }}
      disabled={disabled}
    >
      <SelectTrigger ref={triggerRef} className="w-full" aria-label="우선순위">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
