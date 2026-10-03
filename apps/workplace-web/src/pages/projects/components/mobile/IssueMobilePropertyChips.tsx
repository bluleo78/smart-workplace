// 모바일 이슈 상세 속성 칩 줄(WP-196) — 데스크톱은 우측 레일에 있는 속성이 모바일에선 맨 아래(활동 뒤)라 첫 화면에 안 보였다.
// 제목 바로 아래 칩(상태·담당자·우선순위·마감·에픽·＋ 속성)으로 올리고, 탭하면 해당 선택 시트를 연다.
// 에픽 칩은 EPIC(부모 불가)·SUBTASK(부모가 태스크) 이슈에선 숨긴다 — SUBTASK 부모는 「＋ 속성」 시트에서 편집.
import { CalendarDays, Diamond, Flag, Plus, User } from 'lucide-react';
import { useState } from 'react';

import { MobileDateSheet } from '@/components/mobile/MobileDateSheet';
import { MobileMultiPickerSheet } from '@/components/mobile/MobileMultiPickerSheet';
import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';
import { cn } from '@/lib/utils';

import { IssueStatusIcon } from '../../../../components/issues/IssueStatusIcon';
import { useProjectEpics } from '../../../../hooks/queries/useProjectEpics';
import { useProjectMembers } from '../../../../hooks/queries/useProjectMembers';
import { useUpdateIssueAssignees } from '../../../../hooks/queries/useUpdateIssueAssignees';
import { useUpdateIssueParent } from '../../../../hooks/queries/useUpdateIssueParent';
import { formatDateMonthDay } from '../../../../lib/formatters';
import { ISSUE_PRIORITY_LABEL, ISSUE_STATUS_LABEL, ISSUE_STATUSES } from '../../../../lib/issueGrouping';
import type { IssuePriority, IssueResponse, IssueStatus, UpdateIssueRequest } from '../../../../types/issue';
import { incompleteBlockers } from '../incompleteBlockers';
import { StatusDoneBlockedDialog } from '../IssueStatusSelect';
import { MOBILE_CHIP } from './chipStyles';

const NO_EPIC = 'none';
type Sheet = 'status' | 'priority' | 'assignee' | 'due' | 'epic' | null;

export function IssueMobilePropertyChips({
  projectKey, issue, canEditWorkflow, updatePending, onPatch, onOpenMore,
}: {
  projectKey: string;
  issue: IssueResponse;
  canEditWorkflow: boolean;
  updatePending: boolean;
  onPatch: (changes: UpdateIssueRequest) => void;
  onOpenMore: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  // 완료 전환 확인 대기 — 미완료 선행 이슈가 있을 때만(#827, 데스크톱 Select 와 같은 다이얼로그).
  const [confirmDone, setConfirmDone] = useState(false);
  const typeName = issue.type?.name;
  const showEpic = typeName !== 'EPIC' && typeName !== 'SUBTASK';
  const members = useProjectMembers(projectKey);
  // 에픽 목록은 에픽 칩을 쓸 수 있을 때만 조회.
  const { epics } = useProjectEpics(projectKey, showEpic);
  const assignees = useUpdateIssueAssignees(projectKey, issue.number);
  const parent = useUpdateIssueParent(projectKey, issue.number);
  const blockers = incompleteBlockers(issue.blockedBy ?? []);
  const disabled = !canEditWorkflow || updatePending;
  const close = () => setSheet(null);
  const muted = (empty: boolean) => (empty ? 'text-muted-foreground' : undefined);

  const chip = (key: Exclude<Sheet, null>, label: string, content: React.ReactNode, empty = false) => (
    <button
      type="button"
      aria-label={label}
      data-testid={`mobile-prop-${key}`}
      disabled={disabled}
      onClick={() => setSheet(key)}
      className={cn(MOBILE_CHIP, 'max-w-full disabled:opacity-60', muted(empty))}
    >
      {content}
    </button>
  );

  const firstAssignee = issue.assignees[0];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 py-2" data-testid="mobile-prop-chips">
        {issue.blocked && (
          <span data-testid="issue-blocked-badge" className="inline-flex h-8 items-center gap-1 rounded-full bg-destructive/15 px-3 text-xs text-destructive">
            ⛔ 차단됨
          </span>
        )}
        {chip('status', '상태', <><IssueStatusIcon status={issue.status} decorative className="size-4" />{ISSUE_STATUS_LABEL[issue.status]}</>)}
        {chip(
          'assignee',
          '담당자',
          <>
            <User className="size-4" aria-hidden />
            <span className="truncate">
              {firstAssignee ? firstAssignee.name : '담당자 없음'}
              {issue.assignees.length > 1 && ` +${issue.assignees.length - 1}`}
            </span>
          </>,
          !firstAssignee,
        )}
        {chip('priority', '우선순위', <><Flag className="size-4" aria-hidden />{ISSUE_PRIORITY_LABEL[issue.priority]}</>)}
        {chip('due', '마감일', <><CalendarDays className="size-4" aria-hidden />{issue.dueDate ? formatDateMonthDay(issue.dueDate) : '마감 없음'}</>, !issue.dueDate)}
        {showEpic &&
          chip(
            'epic',
            '에픽',
            <>
              <Diamond className="size-4 shrink-0 text-ai-accent" aria-hidden />
              <span className="max-w-40 truncate">{issue.parent ? issue.parent.title : '에픽 없음'}</span>
            </>,
            !issue.parent,
          )}
        <button type="button" data-testid="mobile-prop-more" onClick={onOpenMore} className={cn(MOBILE_CHIP, 'text-muted-foreground')}>
          <Plus className="size-4" aria-hidden />속성
        </button>
      </div>

      <MobilePickerSheet
        testId="issue-status-sheet"
        open={sheet === 'status'}
        onClose={close}
        title="상태"
        value={issue.status}
        options={ISSUE_STATUSES.map((s) => ({ value: s, label: ISSUE_STATUS_LABEL[s], icon: <IssueStatusIcon status={s} decorative /> }))}
        onSelect={(v) => {
          const next = v as IssueStatus;
          if (next === issue.status) return;
          if (next === 'DONE' && blockers.length > 0) setConfirmDone(true);
          else onPatch({ status: next });
        }}
      />
      <StatusDoneBlockedDialog
        open={confirmDone}
        blockers={blockers}
        projectKey={projectKey}
        onCancel={() => setConfirmDone(false)}
        onConfirm={() => {
          setConfirmDone(false);
          onPatch({ status: 'DONE' });
        }}
      />
      <MobilePickerSheet
        testId="issue-priority-sheet"
        open={sheet === 'priority'}
        onClose={close}
        title="우선순위"
        value={issue.priority}
        options={(['HIGH', 'MID', 'LOW'] as IssuePriority[]).map((p) => ({ value: p, label: ISSUE_PRIORITY_LABEL[p] }))}
        onSelect={(v) => v !== issue.priority && onPatch({ priority: v as IssuePriority })}
      />
      <MobileMultiPickerSheet
        testId="issue-assignee-sheet"
        open={sheet === 'assignee'}
        title="담당자"
        searchable
        value={issue.assignees.map((a) => String(a.id))}
        options={(members.data ?? []).map((m) => ({ value: String(m.userId), label: m.name }))}
        onClose={(picked) => {
          close();
          const next = picked.map(Number);
          const cur = issue.assignees.map((a) => a.id);
          // 집합이 같으면 요청하지 않는다(데스크톱 팝오버와 동일).
          if (next.length !== cur.length || next.some((id) => !cur.includes(id))) assignees.mutate(next);
        }}
      />
      <MobileDateSheet
        testId="issue-due-sheet"
        open={sheet === 'due'}
        onClose={close}
        title="마감일"
        value={issue.dueDate}
        onSelect={(d) => onPatch({ dueDate: d ?? undefined, clearDueDate: !d })}
      />
      {showEpic && (
        <MobilePickerSheet
          testId="issue-epic-sheet"
          open={sheet === 'epic'}
          onClose={close}
          title="에픽"
          searchable={epics.length > 8}
          value={String(issue.parent?.number ?? NO_EPIC)}
          options={[
            { value: NO_EPIC, label: '에픽 없음' },
            ...epics.map((e) => ({ value: String(e.number), label: e.title, hint: `${e.childDoneCount}/${e.childCount}` })),
          ]}
          onSelect={(v) => {
            const to = v === NO_EPIC ? null : Number(v);
            if (to !== (issue.parent?.number ?? null)) parent.mutate(to);
          }}
        />
      )}
    </>
  );
}
