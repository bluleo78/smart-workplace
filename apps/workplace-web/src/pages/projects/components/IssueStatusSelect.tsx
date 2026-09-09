// 이슈 상태 인라인 변경 select. shadcn/Radix Select 사용.
// 미완료 선행(blockedBy) 이슈가 있는 상태에서 '완료'로 전환하면 AlertDialog 로 한 번 확인한다(#827).
// 의존성은 일정(scheduling) 관계라 서버는 전환을 막지 않는다 — soft 경고 정책(#669 와 동일 원칙).

import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { IssueLinkSummary, IssueStatus } from '../../../types/issue';

const OPTIONS: { value: IssueStatus; label: string }[] = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

// 미완료 판정 — DONE/CANCELED 가 아니면 아직 진행 중(#826 헤더 배지와 동일 기준).
function isIncomplete(l: IssueLinkSummary): boolean {
  return l.status !== 'DONE' && l.status !== 'CANCELED';
}

// 상태 변경 시 onChange 콜백으로 상위에 위임 — 인라인 patch 호출에 사용.
// blockedBy 를 넘기면 DONE 전환 직전 미완료 선행 이슈 확인 다이얼로그를 끼워 넣는다(취소 시 전환 중단).
export function IssueStatusSelect({
  value,
  onChange,
  disabled,
  blockedBy = [],
  projectKey,
}: {
  value: IssueStatus;
  onChange: (v: IssueStatus) => void;
  disabled?: boolean;
  blockedBy?: IssueLinkSummary[];
  // 다이얼로그에 선행 이슈 키(KEY-번호)를 표시하기 위한 프로젝트 키 — 없으면 #번호 로 표시.
  projectKey?: string;
}) {
  // 확인 대기 중인 목표 상태 — null 이면 다이얼로그 닫힘.
  const [pending, setPending] = useState<IssueStatus | null>(null);
  const incompleteBlockers = blockedBy.filter(isIncomplete);

  const handleChange = (v: IssueStatus) => {
    // 완료 전환 + 미완료 선행 존재 → 즉시 PATCH 하지 않고 확인 다이얼로그.
    if (v === 'DONE' && v !== value && incompleteBlockers.length > 0) {
      setPending(v);
      return;
    }
    onChange(v);
  };

  const issueKey = (n: number) => (projectKey ? `${projectKey}-${n}` : `#${n}`);

  return (
    <>
      <Select value={value} onValueChange={(v) => handleChange(v as IssueStatus)} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label="상태" data-testid="issue-status-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 미완료 선행 이슈 확인 — 취소하면 상태 유지, 확인하면 그대로 PATCH (#827) */}
      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <AlertDialogContent data-testid="status-done-blocked-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>선행 이슈가 아직 완료되지 않았습니다</AlertDialogTitle>
            <AlertDialogDescription>
              선행 이슈 {incompleteBlockers.length}건이 아직 완료되지 않았습니다. 그래도 완료로 변경할까요?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul
            className="max-h-40 space-y-1 overflow-y-auto text-sm"
            data-testid="status-done-blocked-list"
          >
            {incompleteBlockers.map((l) => (
              <li key={l.number} className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{issueKey(l.number)}</span>
                <span className="truncate">{l.title}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="status-done-blocked-cancel">취소</AlertDialogCancel>
            <AlertDialogAction
              data-testid="status-done-blocked-confirm"
              onClick={() => {
                if (pending) onChange(pending);
                setPending(null);
              }}
            >
              완료로 변경
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
