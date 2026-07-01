// 이슈 상태 인라인 변경 select. shadcn/Radix Select 사용.

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { IssueStatus } from '../../../types/issue';

const OPTIONS: { value: IssueStatus; label: string }[] = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

// 상태 변경 시 onChange 콜백으로 상위에 위임 — 인라인 patch 호출에 사용.
export function IssueStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: IssueStatus;
  onChange: (v: IssueStatus) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as IssueStatus)} disabled={disabled}>
      <SelectTrigger className="w-full" aria-label="상태" data-testid="issue-status-select">
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
