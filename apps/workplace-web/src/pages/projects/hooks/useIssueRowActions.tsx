// 이슈 1건 액션 — 목록·보드가 하나씩 소유하고, 행·카드는 open/openMenu(issue) 만 호출한다(행 memo 유지).
// - 데스크톱(WP-273 시안 A): 행 끝 「⋯」·우클릭 → IssueRowMenu 드롭다운. 다중 선택된 행에서 열면 선택 전체에 적용.
// - 모바일(WP-273 시안 M1): 「⋯」·길게 누르기 → 액션 시트(줄마다 현재 값) → 상태·담당자·우선순위·에픽·AI 선택 시트.
// 시트는 한 번에 하나만 연다. 변경은 낙관적 mutation(상태·에픽은 드래그와 같은 경로)을 재사용한다.
import { Bot, Check, CheckSquare, CircleDot, Layers, Link2, SignalHigh, Trash2, UserRound } from 'lucide-react';
import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { IssuePriorityBars } from '@/components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon';
import { MobileActionSheet, type MobileSheetAction } from '@/components/mobile/MobileActionSheet';
import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';
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
import { AgentBadge } from '@/components/users/AgentBadge';
import { UserAvatar } from '@/components/users/UserAvatar';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/useIsMobile';
import { copyText } from '@/lib/copyText';

import { useBulkAssign, useBulkDeleteIssues, useBulkUpdatePriority, useBulkUpdateStatus } from '../../../hooks/queries/useBulkIssueActions';
import { useRemoveIssue, useSetIssueAssignees, useUpdateIssuePriority } from '../../../hooks/queries/useIssueRowMutations';
import { useMoveIssueEpic } from '../../../hooks/queries/useMoveIssueEpic';
import { useProjectEpics } from '../../../hooks/queries/useProjectEpics';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useUpdateIssueStatus } from '../../../hooks/queries/useUpdateIssueStatus';
import { epicDragBlockReason } from '../../../lib/epicDnd';
import { ISSUE_PRIORITY_LABEL, ISSUE_PRIORITY_OPTIONS, ISSUE_STATUS_LABEL, ISSUE_STATUSES } from '../../../lib/issueGrouping';
import { rowMenuItems, toggleAssigneeIds } from '../../../lib/issueRowMenu';
import type { IssuePriority, IssueResponse, IssueStatus } from '../../../types/issue';
import type { MemberResponse } from '../../../types/project';
import type { UserSummary } from '../../../types/user';
import { IssueRowMenu, type RowMenuTarget } from '../components/IssueRowMenu';

// 「에픽 없음」 선택지 값 — 에픽 번호(양의 정수)와 겹치지 않는 문자열.
const NO_EPIC = 'none';

type MobileSheet = 'actions' | 'status' | 'epic' | 'priority' | 'assignee' | 'ai';
// 데스크톱 메뉴와 모바일 시트는 동시에 열리지 않으므로 한 상태로 둔다. assigneeIds 는 메뉴가 열린 동안의 담당자(토글 반영).
type Open =
  | { kind: 'menu'; target: RowMenuTarget; assigneeIds: number[] }
  | { kind: 'sheet'; issue: IssueResponse; sheet: MobileSheet; assigneeIds: number[] }
  | null;

/** 메뉴를 연 위치 — 우클릭 지점(start) 또는 ⋯ 버튼 아래 모서리(end). 모바일은 무시. */
export type RowMenuAnchor = { x: number; y: number; align: 'start' | 'end' };
export type OpenRowMenu = (issue: IssueResponse, anchor?: RowMenuAnchor) => void;

/**
 * 데스크톱 행·카드 우클릭 → 메뉴(WP-273). 마우스 우클릭은 커서 위치, 키보드(Shift+F10·메뉴 키)로 연 것은
 * 좌표가 요소 밖(브라우저마다 0,0 또는 임의 위치)이므로 요소 왼쪽 아래에 연다 — 마우스 우클릭은 항상 요소 안에서 일어난다.
 */
export function openRowMenuAtPointer(e: MouseEvent<HTMLElement>, issue: IssueResponse, openMenu: OpenRowMenu) {
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  openMenu(issue, inside ? { x: e.clientX, y: e.clientY, align: 'start' } : { x: r.left + 16, y: r.bottom, align: 'start' });
}

// 프로젝트 멤버 → 담당자 요약(낙관적 패치로 행에 바로 그릴 값).
function toSummary(m: MemberResponse): UserSummary {
  return { id: m.userId, username: m.username, name: m.name, kind: m.kind };
}

export function useIssueRowActions({
  projectKey, canEdit, statuses = ISSUE_STATUSES, onSelect, isSelected, selected, onClearSelection, linkFor,
}: {
  projectKey: string;
  /** 프로젝트 멤버 여부 — 아니면 변경 항목을 노출하지 않는다(서버 assertMember). */
  canEdit: boolean;
  /** 보드 컬럼 등 허용 상태(개인 보드는 3개). */
  statuses?: IssueStatus[];
  /** 목록 다중 선택 진입(모바일) — 있으면 「선택」 행을 시트에 둔다. */
  onSelect?: (issue: IssueResponse) => void;
  /** 이미 선택된 행인지 — 「선택」 행이 토글이라 선택된 행에서는 「선택 해제」로 보여 준다. */
  isSelected?: (issue: IssueResponse) => boolean;
  /** 데스크톱 다중 선택 집합 — 선택된 행에서 메뉴를 열면 선택 전체에 적용한다(아닌 행은 그 행만). */
  selected?: ReadonlySet<number>;
  /** 다중 선택 일괄 작업 성공 후 선택 해제(일괄 바와 같은 동작). */
  onClearSelection?: () => void;
  /** 링크 복사·새 탭 경로 — 미지정 시 팀 풀페이지 상세. 개인 보드는 drawer 경로를 넘긴다. */
  linkFor?: (issue: IssueResponse) => string;
}): {
  /** 모바일 길게 누르기 — 모바일에서만 값이 있다(데스크톱 행은 길게 누르기 대신 우클릭·⋯). */
  open: ((issue: IssueResponse) => void) | undefined;
  /** ⋯ 버튼·우클릭 — 데스크톱은 드롭다운, 모바일은 액션 시트. 안정 참조. */
  openMenu: OpenRowMenu;
  /** 데스크톱 메뉴가 열린 이슈 번호 — 해당 행·카드를 강조하고 ⋯ 를 계속 보이게 한다. */
  menuIssueNumber: number | null;
  sheets: ReactNode;
} {
  const [state, setState] = useState<Open>(null);
  // 삭제 확인 — 메뉴·시트가 닫힌 뒤에도 남아야 해서 따로 둔다.
  const [pendingDelete, setPendingDelete] = useState<{ numbers: number[]; issue: IssueResponse } | null>(null);
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const members = useProjectMembers(projectKey).data ?? [];
  const agents = members.filter((m) => m.kind === 'AGENT');
  const viewerIsOwner = members.some((m) => m.userId === user?.id && m.role === 'OWNER');

  const updateStatus = useUpdateIssueStatus(projectKey);
  const updatePriority = useUpdateIssuePriority(projectKey);
  const setAssignees = useSetIssueAssignees(projectKey);
  const moveEpic = useMoveIssueEpic(projectKey);
  const removeIssue = useRemoveIssue(projectKey);
  const bulkStatus = useBulkUpdateStatus(projectKey);
  const bulkPriority = useBulkUpdatePriority(projectKey);
  const bulkAssign = useBulkAssign(projectKey);
  const bulkDelete = useBulkDeleteIssues(projectKey);
  // 에픽 목록은 에픽 항목을 쓸 때만 필요 — 모바일 멤버이거나 데스크톱 메뉴가 열렸을 때만 조회(훅 순서 고정).
  const { epics, epicType, loading: epicsLoading } = useProjectEpics(projectKey, canEdit && (isMobile || state?.kind === 'menu'));

  // open(길게 누르기)은 모바일에서만 — 행·카드는 핸들러 유무로 길게 누르기 연결 여부를 정한다. 안정 참조(행 memo).
  const open = useMemo(
    () => (isMobile ? (issue: IssueResponse) => setState({ kind: 'sheet', issue, sheet: 'actions', assigneeIds: issue.assignees.map((a) => a.id) }) : undefined),
    [isMobile],
  );
  // openMenu 는 최신 선택 집합을 읽어야 하지만, deps 에 넣으면 선택이 바뀔 때마다 모든 행 memo 가 깨진다(#716) — ref 로 읽는다.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });
  const openMenu = useCallback<OpenRowMenu>(
    (issue, anchor) => {
      const assigneeIds = issue.assignees.map((a) => a.id);
      if (isMobile || !anchor) {
        setState({ kind: 'sheet', issue, sheet: 'actions', assigneeIds });
        return;
      }
      // 선택된 행(2개 이상 선택)에서 열면 선택 전체, 선택 밖 행이면 그 행만(Notion·Linear 관례).
      const sel = selectedRef.current;
      const numbers = sel && sel.size > 1 && sel.has(issue.number) ? [...sel] : [issue.number];
      setState({ kind: 'menu', target: { issue, at: { x: anchor.x, y: anchor.y }, align: anchor.align, numbers }, assigneeIds });
    },
    [isMobile],
  );
  const close = () => setState(null);

  const issue = state?.kind === 'menu' ? state.target.issue : state?.issue;
  const numbers = state?.kind === 'menu' ? state.target.numbers : issue ? [issue.number] : [];
  const bulk = numbers.length > 1;
  // 메뉴가 열린 동안의 실제 담당자 — 열 때의 스냅샷(issue.assignees)이 아니라 토글이 반영된 assigneeIds 기준.
  // 위임 여부 판정·AI 위임 요청이 같은 메뉴에서 바꾼 담당자를 되돌리지 않게 한다.
  const known = new Map<number, UserSummary>((issue?.assignees ?? []).map((a) => [a.id, a]));
  members.forEach((x) => known.set(x.userId, toSummary(x)));
  const liveAssignees = (state?.assigneeIds ?? []).map((id) => known.get(id)).filter((u): u is UserSummary => u != null);
  const items = rowMenuItems({
    issue: { assignees: liveAssignees, reporterId: issue?.reporterId ?? -1 },
    canEdit,
    viewerId: user?.id ?? null,
    viewerIsOwner,
    canAssignEpic: !!epicType && !!issue && epicDragBlockReason(issue) == null,
    agents,
    count: numbers.length,
  });
  const assigneeIds = state?.assigneeIds ?? [];

  // ── 액션 ──────────────────────────────────────────────
  const afterBulk = { onSuccess: () => onClearSelection?.() };
  const changeStatus = (s: IssueStatus) => {
    if (bulk) bulkStatus.mutate({ numbers, status: s }, afterBulk);
    else if (issue && s !== issue.status) updateStatus.mutate({ number: issue.number, status: s });
  };
  const changePriority = (p: IssuePriority) => {
    if (bulk) bulkPriority.mutate({ numbers, priority: p }, afterBulk);
    else if (issue && p !== issue.priority) updatePriority.mutate({ number: issue.number, priority: p });
  };
  // 메뉴 담당자 집합을 바꾸고 요청한다. 함수형 갱신 — 모바일 시트가 먼저 닫혔으면(null) 다시 열지 않는다.
  // 실패하면 같은 이슈의 메뉴가 아직 열려 있을 때만 ✓ 를 이전 집합으로 되돌린다(캐시는 mutation 이 복원).
  const replaceAssignees = (nextIds: number[], successMessage?: string) => {
    if (!issue || !state) return;
    const prevIds = state.assigneeIds;
    const number = issue.number;
    const sameIssue = (s: Open) => s != null && (s.kind === 'menu' ? s.target.issue.number : s.issue.number) === number;
    setState((s) => (sameIssue(s) ? { ...s!, assigneeIds: nextIds } : s));
    const next = nextIds.map((id) => known.get(id)).filter((u): u is UserSummary => u != null);
    setAssignees.mutate(
      { number, assignees: next, successMessage },
      { onError: () => setState((s) => (sameIssue(s) ? { ...s!, assigneeIds: prevIds } : s)) },
    );
  };
  // 담당자 토글 — 집합 교체 API 라 현재 담당자 전체에 넣거나 빼서 보낸다. 멤버 목록에 없는 기존 담당자도 유지.
  const toggleAssignee = (m: MemberResponse) => {
    if (state) replaceAssignees(toggleAssigneeIds(state.assigneeIds, m.userId));
  };
  const assignBulk = (userIds: number[]) => bulkAssign.mutate({ numbers, userIds }, afterBulk);
  // AI 위임 = AGENT 담당자 추가(기존 담당자 유지) — 위임 배지·AI 처리 흐름은 담당자 기준으로 동작한다.
  const delegate = (a: MemberResponse) => {
    if (state) replaceAssignees([...state.assigneeIds.filter((id) => id !== a.userId), a.userId], `${a.name}에게 맡겼습니다`);
  };
  const changeEpic = (target: IssueResponse | null) => {
    if (!issue) return;
    const to = target && target.type ? { number: target.number, title: target.title, type: target.type } : null;
    if ((to?.number ?? null) !== (issue.parent?.number ?? null)) moveEpic.mutate({ issue, to });
  };
  const linkOf = (i: IssueResponse) => new URL(linkFor?.(i) ?? `/projects/${projectKey}/issues/${i.number}`, window.location.href).href;
  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`${what}를 복사했습니다`);
    else toast.error(`${what}를 복사하지 못했습니다`);
  };
  const copyLink = () => issue && void copy(linkOf(issue), '링크');
  const copyKey = () => issue && void copy(`${projectKey}-${issue.number}`, '키');
  const openTab = () => issue && window.open(linkOf(issue), '_blank', 'noopener');
  const askDelete = () => issue && setPendingDelete({ numbers, issue });
  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.numbers.length > 1) bulkDelete.mutate(pendingDelete.numbers, afterBulk);
    else removeIssue.mutate(pendingDelete.numbers[0]);
    setPendingDelete(null);
  };

  const deleteDialog = (
    <AlertDialog open={pendingDelete != null} onOpenChange={(o) => !o && setPendingDelete(null)}>
      <AlertDialogContent data-testid="issue-row-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>태스크 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDelete && pendingDelete.numbers.length > 1
              ? `선택한 ${pendingDelete.numbers.length}개 태스크를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`
              : pendingDelete && pendingDelete.issue.childCount > 0
                ? `「${pendingDelete.issue.title}」에는 하위 태스크가 ${pendingDelete.issue.childCount}개 있습니다. 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
                : `「${pendingDelete?.issue.title ?? ''}」을(를) 삭제할까요? 이 작업은 되돌릴 수 없습니다.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction variant="destructive" data-testid="issue-row-delete-confirm" onClick={confirmDelete}>
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // ── 데스크톱 ──────────────────────────────────────────
  if (!isMobile) {
    const sheets = (
      <>
        <IssueRowMenu
          target={state?.kind === 'menu' ? state.target : null}
          onClose={close}
          items={items}
          statuses={statuses}
          members={members}
          agents={agents}
          epics={epics}
          epicsLoading={epicsLoading}
          assigneeIds={assigneeIds}
          onStatus={changeStatus}
          onPriority={changePriority}
          onToggleAssignee={toggleAssignee}
          onBulkAssign={assignBulk}
          onEpic={changeEpic}
          onDelegate={delegate}
          onCopyLink={copyLink}
          onCopyKey={copyKey}
          onOpenTab={openTab}
          onDelete={askDelete}
        />
        {deleteDialog}
      </>
    );
    return { open, openMenu, menuIssueNumber: state?.kind === 'menu' ? state.target.issue.number : null, sheets };
  }

  // ── 모바일 ────────────────────────────────────────────
  const sheet = state?.kind === 'sheet' ? state.sheet : null;
  const toSheet = (s: MobileSheet) => state?.kind === 'sheet' && setState({ ...state, sheet: s });
  const assigneeNames = issue
    ? members.filter((m) => assigneeIds.includes(m.userId)).map((m) => m.name).join(', ') || '미지정'
    : '';
  const actions: MobileSheetAction[] = [];
  if (issue && items.status) {
    actions.push({ key: 'status', label: '상태', icon: <CircleDot />, hint: ISSUE_STATUS_LABEL[issue.status], onSelect: () => toSheet('status') });
  }
  if (issue && items.assignee) {
    actions.push({ key: 'assignee', label: '담당자', icon: <UserRound />, hint: assigneeNames, onSelect: () => toSheet('assignee') });
  }
  if (issue && items.priority) {
    actions.push({ key: 'priority', label: '우선순위', icon: <SignalHigh />, hint: ISSUE_PRIORITY_LABEL[issue.priority], onSelect: () => toSheet('priority') });
  }
  if (issue && items.epic) {
    actions.push({ key: 'epic', label: '에픽', icon: <Layers />, hint: issue.parent?.title ?? '없음', onSelect: () => toSheet('epic') });
  }
  if (issue && items.ai) {
    actions.push({
      key: 'ai', label: 'AI에게 맡기기', icon: <Bot />, ai: true,
      // AI 멤버가 하나면 바로 맡기고, 여럿이면 고르는 시트로.
      onSelect: () => (agents.length === 1 ? delegate(agents[0]) : toSheet('ai')),
    });
  }
  if (issue) actions.push({ key: 'copy-link', label: '링크 복사', icon: <Link2 />, onSelect: copyLink });
  if (issue && onSelect) actions.push({ key: 'select', label: isSelected?.(issue) ? '선택 해제' : '선택', icon: <CheckSquare />, onSelect: () => onSelect(issue) });
  if (issue && items.delete) actions.push({ key: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: askDelete });

  const sheets = (
    <>
      <MobileActionSheet open={sheet === 'actions'} onClose={close} title={issue?.title ?? ''} actions={actions} />
      <MobilePickerSheet
        testId="issue-status-picker"
        open={sheet === 'status'}
        onClose={close}
        title="상태 변경"
        value={issue?.status ?? null}
        options={statuses.map((s) => ({ value: s, label: ISSUE_STATUS_LABEL[s], icon: <IssueStatusIcon status={s} decorative /> }))}
        onSelect={(v) => changeStatus(v as IssueStatus)}
      />
      <MobilePickerSheet
        testId="issue-priority-picker"
        open={sheet === 'priority'}
        onClose={close}
        title="우선순위"
        value={issue?.priority ?? null}
        options={ISSUE_PRIORITY_OPTIONS.map((o) => ({ ...o, icon: <IssuePriorityBars priority={o.value} /> }))}
        onSelect={(v) => changePriority(v as IssuePriority)}
      />
      {/* 담당자 — 한 명을 누르면 넣거나 빼는 토글(다중 담당자). 지금 담당자는 ✓ 힌트로 표시. */}
      <MobilePickerSheet
        testId="issue-assignee-picker"
        open={sheet === 'assignee'}
        onClose={close}
        title="담당자"
        searchable={members.length > 8}
        value={null}
        options={members.map((m) => ({
          value: String(m.userId),
          label: m.name,
          icon: <UserAvatar user={toSummary(m)} size="xs" agent={m.kind === 'AGENT'} />,
          hint: (
            <>
              {m.kind === 'AGENT' && <AgentBadge size="xs" />}
              {assigneeIds.includes(m.userId) && <Check className="size-4 text-primary" aria-label="담당 중" />}
            </>
          ),
        }))}
        onSelect={(v) => {
          const m = members.find((x) => String(x.userId) === v);
          if (m) toggleAssignee(m);
        }}
      />
      <MobilePickerSheet
        testId="issue-epic-picker"
        open={sheet === 'epic'}
        onClose={close}
        title="에픽 지정"
        searchable={epics.length > 8}
        value={issue ? String(issue.parent?.number ?? NO_EPIC) : null}
        options={[
          { value: NO_EPIC, label: '에픽 없음' },
          ...epics.map((e) => ({ value: String(e.number), label: e.title, hint: `${e.childDoneCount}/${e.childCount}` })),
        ]}
        onSelect={(v) => changeEpic(v === NO_EPIC ? null : (epics.find((e) => String(e.number) === v) ?? null))}
      />
      <MobilePickerSheet
        testId="issue-ai-picker"
        open={sheet === 'ai'}
        onClose={close}
        title="AI에게 맡기기"
        value={null}
        options={agents.map((a) => ({ value: String(a.userId), label: a.name, icon: <UserAvatar user={toSummary(a)} size="xs" agent /> }))}
        onSelect={(v) => {
          const a = agents.find((x) => String(x.userId) === v);
          if (a) delegate(a);
        }}
      />
      {deleteDialog}
    </>
  );
  return { open, openMenu, menuIssueNumber: null, sheets };
}
