// 이슈 목록 일괄 작업 — 선택 툴바(상태 변경/담당자 지정/삭제/선택 해제) + 삭제 확인 다이얼로그.
// #606 에서 Drive DrivePage.tsx 의 체크박스+벌크 툴바 패턴을 가져왔고, 평면 목록(IssueListView)과
// 사이클 구간 목록(IssueCycleGroupedList, #878)이 같은 동작을 쓰도록 분리했다.

import { UserPlus } from 'lucide-react';
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
} from '../../../components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { AgentBadge } from '../../../components/users/AgentBadge';
import { UserAvatar } from '../../../components/users/UserAvatar';
import {
  useBulkAssign,
  useBulkDeleteIssues,
  useBulkUpdateStatus,
} from '../../../hooks/queries/useBulkIssueActions';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useIsMobile } from '../../../hooks/useIsMobile';
import type { IssueStatus } from '../../../types/issue';

// 상태 일괄 변경 드롭다운 옵션 — IssueStatusSelect 와 동일한 라벨 세트.
const STATUS_OPTIONS: { value: IssueStatus; label: string }[] = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

/** 선택이 있을 때만 툴바를 노출한다. 삭제 확인 다이얼로그는 포털이라 항상 마운트해 둔다. */
export function IssueBulkActions({
  projectKey,
  selected,
  onClear,
}: {
  projectKey: string;
  /** 선택된 이슈 number 집합. */
  selected: Set<number>;
  /** 선택 해제 — 일괄 작업 성공 후에도 호출한다. */
  onClear: () => void;
}) {
  const isMobile = useIsMobile();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const members = useProjectMembers(projectKey);
  const bulkStatus = useBulkUpdateStatus(projectKey);
  const bulkAssign = useBulkAssign(projectKey);
  const bulkDelete = useBulkDeleteIssues(projectKey);
  const selectedNumbers = [...selected];
  // 모바일은 터치 타깃 44px 확보 + 눌림 피드백, 데스크톱은 기존 hover 밑줄 유지.
  const triggerCls = isMobile
    ? 'min-h-11 rounded-md px-3 text-muted-foreground active:bg-accent'
    : 'text-muted-foreground hover:underline';

  function onBulkStatus(status: IssueStatus) {
    bulkStatus.mutate({ numbers: selectedNumbers, status }, { onSuccess: onClear });
  }
  function onBulkAssign(userIds: number[]) {
    bulkAssign.mutate({ numbers: selectedNumbers, userIds }, { onSuccess: onClear });
  }
  function onBulkDeleteConfirm() {
    bulkDelete.mutate(selectedNumbers, { onSuccess: onClear });
    setConfirmDeleteOpen(false);
  }

  return (
    <>
      {selected.size > 0 && (
        <div
          data-testid="issue-bulk-toolbar"
          data-mobile={isMobile || undefined}
          className={
            isMobile
              ? // 하단 탭바(--mobile-tabbar-h, MobileTabBar 가 공개) 바로 위에 고정 — 키보드가 열려 있으면 키보드 위.
                'fixed inset-x-0 z-40 flex items-center gap-1 border-t bg-background px-2 py-1.5 text-sm shadow-[0_-2px_8px_rgb(0_0_0/0.06)] bottom-[max(var(--mobile-tabbar-h,0px),var(--kb-inset,0px))]'
              : 'mb-2 flex shrink-0 items-center gap-2 rounded bg-muted px-3 py-2 text-sm'
          }
        >
          {isMobile ? (
            <span className="px-2 font-medium">{selected.size}개 선택</span>
          ) : (
            <span>선택 {selected.size}개</span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="bulk-status-trigger"
                className={triggerCls}
              >
                상태 변경
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {STATUS_OPTIONS.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  data-testid={`bulk-status-option-${o.value}`}
                  onClick={() => onBulkStatus(o.value)}
                >
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="bulk-assignee-trigger"
                className={triggerCls}
              >
                담당자 지정
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                data-testid="bulk-assignee-option-unassign"
                onClick={() => onBulkAssign([])}
              >
                <UserPlus className="h-4 w-4" />
                미지정
              </DropdownMenuItem>
              {(members.data ?? []).map((m) => (
                <DropdownMenuItem
                  key={m.userId}
                  data-testid={`bulk-assignee-option-${m.userId}`}
                  onClick={() => onBulkAssign([m.userId])}
                >
                  <UserAvatar
                    user={{ id: m.userId, username: m.username, name: m.name }}
                    size="xs"
                  />
                  <span>{m.name}</span>
                  {m.kind === 'AGENT' && <AgentBadge size="xs" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            data-testid="bulk-delete"
            onClick={() => setConfirmDeleteOpen(true)}
            className={`${triggerCls} text-destructive`}
          >
            삭제
          </button>
          <button
            type="button"
            data-testid="bulk-clear"
            onClick={onClear}
            className={`${triggerCls} ml-auto`}
          >
            {isMobile ? '완료' : '선택 해제'}
          </button>
        </div>
      )}

      {/* #606: 벌크 삭제 확인 — IssueDetailPage 단건 삭제와 동일한 제어형 AlertDialog 패턴. */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent data-testid="issue-bulk-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>태스크 일괄 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              선택한 {selected.size}개 태스크를 삭제할까요? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="issue-bulk-delete-confirm"
              onClick={onBulkDeleteConfirm}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
