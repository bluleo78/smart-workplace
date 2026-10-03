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
import { ISSUE_PRIORITY_LABEL, ISSUE_PRIORITY_OPTIONS, ISSUE_STATUS_LABEL, ISSUE_STATUSES } from '../../../../lib/issueGrouping';
import type { IssuePriority, IssueResponse, IssueStatus, UpdateIssueRequest } from '../../../../types/issue';
import { incompleteBlockers } from '../incompleteBlockers';
import { StatusDoneBlockedDialog } from '../IssueStatusSelect';
import { MOBILE_CHIP } from './chipStyles';
import { memberOptions } from './issuePropOptions';
import { EpicPickerSheet } from './issuePropSheets';

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
  // 에픽 목록은 에픽 칩을 처음 누를 때(pointerdown — 시트가 열리기 전에 응답이 오도록) 조회를 시작한다(이후 유지) — 칩 라벨은 이슈의 parent 제목이라 목록이 필요 없다.
  const [epicsWanted, setEpicsWanted] = useState(false);
  const { epics, loading: epicsLoading } = useProjectEpics(projectKey, showEpic && epicsWanted);
  const assignees = useUpdateIssueAssignees(projectKey, issue.number);
  const parent = useUpdateIssueParent(projectKey, issue.number);
  const blockers = incompleteBlockers(issue.blockedBy ?? []);
  const disabled = !canEditWorkflow || updatePending;
  const close = () => setSheet(null);
  const muted = (empty: boolean) => (empty ? 'text-muted-foreground' : undefined);

  const chip = (key: Exclude<Sheet, null>, label: string, content: React.ReactNode, empty = false, extraClass?: string) => (
    <button
      type="button"
      aria-label={label}
      data-testid={`mobile-prop-${key}`}
      disabled={disabled}
      onPointerDown={key === 'epic' ? () => setEpicsWanted(true) : undefined}
      onClick={() => {
        if (key === 'epic') setEpicsWanted(true);
        setSheet(key);
      }}
      className={cn(MOBILE_CHIP, 'max-w-full disabled:opacity-60', muted(empty), extraClass)}
    >
      {content}
    </button>
  );

  const firstAssignee = issue.assignees[0];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 py-2" data-testid="mobile-prop-chips">
        {/* 차단됨은 별도 칩 대신 상태 칩에 합친다 — 390px 에서 칩 줄이 한 줄 더 늘어 본문이 밀렸다(디자인 리뷰).
            aria-label 이 내용을 덮어쓰므로 차단 여부도 label 에 넣어 스크린리더가 읽게 한다. testid 는 기존 단언 호환용 안쪽 span. */}
        {chip(
          'status',
          issue.blocked ? `상태: ${ISSUE_STATUS_LABEL[issue.status]}, 차단됨` : '상태',
          <>
            <IssueStatusIcon status={issue.status} decorative className="size-4" />
            {ISSUE_STATUS_LABEL[issue.status]}
            {issue.blocked && <span data-testid="issue-blocked-badge">· 차단됨</span>}
          </>,
          false,
          issue.blocked ? 'border-destructive/30 bg-destructive/15 text-destructive' : undefined,
        )}
        {chip(
          'assignee',
          '담당자',
          <>
            <User className="size-4" aria-hidden />
            {/* 이름만 말줄임하고 +N 은 별도 span 으로 — 같은 truncate 안에 있으면 긴 이름에 +N 이 잘려 사라졌다. */}
            <span className="max-w-28 truncate">{firstAssignee ? firstAssignee.name : '담당자 없음'}</span>
            {issue.assignees.length > 1 && <span className="shrink-0">+{issue.assignees.length - 1}</span>}
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
        options={ISSUE_PRIORITY_OPTIONS}
        onSelect={(v) => v !== issue.priority && onPatch({ priority: v as IssuePriority })}
      />
      <MobileMultiPickerSheet
        testId="issue-assignee-sheet"
        open={sheet === 'assignee'}
        title="담당자"
        searchable
        value={issue.assignees.map((a) => String(a.id))}
        options={memberOptions(members.data)}
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
        <EpicPickerSheet
          testId="issue-epic-sheet"
          open={sheet === 'epic'}
          onClose={close}
          epics={epics}
          loading={epicsLoading}
          value={issue.parent?.number ?? null}
          onSelect={(to) => {
            if (to !== (issue.parent?.number ?? null)) parent.mutate(to);
          }}
        />
      )}
    </>
  );
}
