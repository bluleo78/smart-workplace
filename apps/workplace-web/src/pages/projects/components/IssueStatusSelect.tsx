// 이슈 상태 인라인 변경 select. shadcn/Radix Select 사용.
// 선택지는 프로젝트 상태 목록(이름, WP-808)이고 값은 statusId 다 — 아이콘·종료 판정은 상태의 범주로 한다.
// 미완료 선행(blockedBy) 이슈가 있는 상태에서 완료 범주로 전환하면 AlertDialog 로 한 번 확인한다(#827).
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

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { sortStatuses } from '../../../lib/projectStatuses';
import type { IssueLinkSummary } from '../../../types/issue';
import type { ProjectStatus } from '../../../types/projectStatus';
import { incompleteBlockers } from './incompleteBlockers';

// 완료 전환 확인 다이얼로그(#827) — 데스크톱 Select 와 모바일 상태 칩(WP-196)이 같은 확인을 쓴다.
// 취소하면 상태 유지, 확인하면 호출부가 그대로 PATCH 한다.
export function StatusDoneBlockedDialog({
  open,
  blockers,
  projectKey,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  blockers: IssueLinkSummary[];
  // 선행 이슈 키(KEY-번호) 표시용 프로젝트 키 — 없으면 #번호 로 표시.
  projectKey?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const issueKey = (n: number) => (projectKey ? `${projectKey}-${n}` : `#${n}`);
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent data-testid="status-done-blocked-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>선행 이슈가 아직 완료되지 않았습니다</AlertDialogTitle>
          <AlertDialogDescription>
            선행 이슈 {blockers.length}건이 아직 완료되지 않았습니다. 그래도 완료로 변경할까요?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul
          className="max-h-40 space-y-1 overflow-y-auto text-sm"
          data-testid="status-done-blocked-list"
        >
          {blockers.map((l) => (
            <li key={l.number} className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{issueKey(l.number)}</span>
              <span className="truncate">{l.title}</span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="status-done-blocked-cancel">취소</AlertDialogCancel>
          <AlertDialogAction data-testid="status-done-blocked-confirm" onClick={onConfirm}>
            완료로 변경
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// 상태 변경 시 onChange 콜백으로 상위에 위임 — 인라인 patch 호출에 사용(호출부가 statusId·이름·범주를 함께 쓴다).
// blockedBy 를 넘기면 완료 범주 전환 직전 미완료 선행 이슈 확인 다이얼로그를 끼워 넣는다(취소 시 전환 중단).
export function IssueStatusSelect({
  value,
  statuses,
  currentName,
  onChange,
  disabled,
  blockedBy = [],
  projectKey,
}: {
  /** 현재 statusId. */
  value: number;
  /** 프로젝트 상태 목록 — 표시 순서로 정렬해 옵션으로 쓴다. */
  statuses: readonly ProjectStatus[];
  /** 현재 상태 이름(응답 statusName) — 상태 목록 로딩 중이거나 목록에 없는 statusId 면 트리거에 대신 보인다. */
  currentName?: string;
  onChange: (s: ProjectStatus) => void;
  disabled?: boolean;
  blockedBy?: IssueLinkSummary[];
  // 다이얼로그에 선행 이슈 키(KEY-번호)를 표시하기 위한 프로젝트 키 — 없으면 #번호 로 표시.
  projectKey?: string;
}) {
  // 확인 대기 중인 목표 상태 — null 이면 다이얼로그 닫힘.
  const [pending, setPending] = useState<ProjectStatus | null>(null);
  const blockers = incompleteBlockers(blockedBy);
  const options = sortStatuses(statuses);
  const current = options.find((s) => s.id === value);
  // 트리거 툴팁 — 긴 이름은 말줄임되므로 전체 이름을 title 로 남긴다.
  const triggerName = current?.name ?? currentName;

  const handleChange = (id: string) => {
    const next = options.find((s) => String(s.id) === id);
    if (!next || next.id === value) return;
    // 완료 범주로 처음 들어가고 미완료 선행이 있으면 → 즉시 PATCH 하지 않고 확인 다이얼로그.
    // 같은 완료 범주 안 이동(배포됨 → 완료)은 이미 완료라 다시 묻지 않는다.
    if (next.category === 'DONE' && current?.category !== 'DONE' && blockers.length > 0) {
      setPending(next);
      return;
    }
    onChange(next);
  };

  return (
    <>
      <Select value={String(value)} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label="상태" title={triggerName} data-testid="issue-status-select">
          {/* 목록에서 현재 상태를 찾으면 Radix 가 그 항목을 그리고, 못 찾으면(로딩 중 등) 응답의 이름을 그대로 보인다.
              이름은 min-w-0 truncate span 으로 감싼다 — 값 영역이 flex + line-clamp 라 텍스트 노드만으론 말줄임표가 생기지 않는다. */}
          <SelectValue>{current ? undefined : currentName && <span className="min-w-0 truncate">{currentName}</span>}</SelectValue>
        </SelectTrigger>
        {/* popper + collisionPadding — 내용 폭만큼 커지는 item-aligned 는 화면 경계를 무시해 30자 이름이면 오른쪽으로 넘쳤다.
            popper 는 Radix 가 화면 안(여백 8px)으로 밀어 넣는다. 트리거 오른쪽 끝에 맞춰 연다. */}
        <SelectContent position="popper" align="end" collisionPadding={8}>
          {options.map((s) => (
            <SelectItem key={s.id} value={String(s.id)} data-testid={`issue-status-option-${s.id}`}>
              <IssueStatusIcon status={s.category} decorative className="size-4" />
              <span className="min-w-0 truncate">{s.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 미완료 선행 이슈 확인 — 취소하면 상태 유지, 확인하면 그대로 PATCH (#827) */}
      <StatusDoneBlockedDialog
        open={pending !== null}
        blockers={blockers}
        projectKey={projectKey}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) onChange(pending);
          setPending(null);
        }}
      />
    </>
  );
}
