// 이슈 우선순위 인라인 변경 select. shadcn/Radix Select 사용.

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  return (
    <Select value={value} onValueChange={(v) => onChange(v as IssuePriority)} disabled={disabled}>
      <SelectTrigger className="w-36" aria-label="우선순위">
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
