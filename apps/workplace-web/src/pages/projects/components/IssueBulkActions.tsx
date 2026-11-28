// 이슈 목록 일괄 작업 — 선택 툴바(상태 변경/담당자 지정/삭제/선택 해제) + 삭제 확인 다이얼로그.
// #606 에서 Drive DrivePage.tsx 의 체크박스+벌크 툴바 패턴을 가져왔고, 평면 목록(IssueListView)과
// 사이클 구간 목록(IssueCycleGroupedList, #878)이 같은 동작을 쓰도록 분리했다.

import { useQueryClient } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { type FocusEvent, Fragment, useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu';
import { assigneeCandidates } from '@/lib/assigneeCandidates';

import { IssueStatusIcon } from '../../../components/issues/IssueStatusIcon';
import { MobilePickerSheet } from '../../../components/mobile/MobilePickerSheet';
import { ResultStatus } from '../../../components/ResultStatus';
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
import { AgentBadge } from '../../../components/users/AgentBadge';
import { UserAvatar } from '../../../components/users/UserAvatar';
import { findIssueInSearchCache } from '../../../hooks/queries/issueSearchCache';
import {
  useBulkAssign,
  useBulkDeleteIssues,
  useBulkUpdateStatus,
} from '../../../hooks/queries/useBulkIssueActions';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useProjectStatusList } from '../../../hooks/queries/useProjectStatuses';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { failedOf } from '../../../lib/bulkResult';
import { bulkSelectionAnnouncement } from '../../../lib/bulkSelectionAnnouncement';
import type { ClosedHidingNotice } from '../../../lib/closedHiding';
import { bulkDeleteDescription, countCascadedChildren } from '../../../lib/issueBulkDelete';
import { ISSUE_STATUS_LABEL, ISSUE_STATUSES } from '../../../lib/issueGrouping';
import { findStatus, statusesByCategory } from '../../../lib/projectStatuses';
import { HIDE_SCROLLBAR } from '../../../lib/scrollStyles';
import type { ProjectStatus } from '../../../types/projectStatus';
import { statusPickerOptions } from '../hooks/statusFacets';

/**
 * 모바일 고정 바(+하단 탭바) 높이만큼의 여백 — 목록 맨 아래 행이 바에 가리지 않게 목록 끝에 둔다.
 * 바는 목록 위에 렌더되지만 fixed 라 흐름 밖이므로, 여백은 목록 끝에서 호출처가 따로 둔다. 모바일·선택 중에만 렌더.
 */
export function BulkBarSpacer({ active }: { active: boolean }) {
  const isMobile = useIsMobile();
  return isMobile && active ? <div aria-hidden className="h-[calc(4rem+env(safe-area-inset-bottom))]" /> : null;
}

/** 바 안에서 초점 단추를 드러낼 때 바 테두리와 띄우는 좌우 여백 — 바의 px-3(12px)과 같다(WP-2070). */
const BAR_REVEAL_PAD = 12;

/**
 * 데스크톱 일괄 작업 바(가로 스크롤 영역) 안에서 키보드 초점을 받은 단추가 바 밖으로 잘려 있으면, 바만 가로로 스크롤해 보여 준다(WP-2070).
 * 브라우저(Chromium)는 초점 요소가 조금이라도 보이면 스크롤하지 않아, 바 오른쪽 끝에 반쯤 걸린 「선택 해제」에 Tab 으로 가도 잘린 채 남았다.
 * - 바 요소의 scrollLeft 만 바꾼다. scrollIntoView 는 조상(목록 슬롯)까지 움직여, 슬롯의 scroll-pt-11 여백 때문에 바 단추에 초점이 갈 때마다
 *   목록이 약 35px 위로 튀었다. 단추와 바의 사각형으로 넘친 만큼(좌우 여백 BAR_REVEAL_PAD 포함)만 옮기고, 이미 다 보이면 움직이지 않는다.
 *   (브라우저 자체의 초점 스크롤이 슬롯을 끌어올리던 것은 바 단추의 scroll-margin 이 막는다 — 바 className 의 *:-scroll-mt-9 *:scroll-mb-11 주석.)
 * - React onFocus 는 포털 자손(드롭다운 메뉴 항목)의 초점에도 버블된다 — 바 DOM 안의 자손일 때만 다룬다.
 * - 키보드 초점(:focus-visible)일 때만 — 반쯤 잘린 단추를 마우스로 누르면 mousedown 초점에 바가 스크롤돼 mouseup 이 다른 곳에 떨어져 클릭이 빗나갔다.
 */
function revealFocusedInBar(e: FocusEvent<HTMLDivElement>) {
  const bar = e.currentTarget;
  const target = e.target as Element;
  if (target === bar || !bar.contains(target) || !target.matches(':focus-visible')) return;
  const b = bar.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  // 바의 안쪽 가장자리(테두리 제외)에서 여백만큼 들어간 선을 기준으로 넘친 거리를 잰다.
  const left = b.left + bar.clientLeft + BAR_REVEAL_PAD;
  const right = b.left + bar.clientLeft + bar.clientWidth - BAR_REVEAL_PAD;
  const delta = t.left < left ? t.left - left : t.right > right ? t.right - right : 0;
  if (delta !== 0) bar.scrollTo({ left: bar.scrollLeft + delta });
}

/** 선택이 있을 때만 툴바를 노출한다. 삭제 확인 다이얼로그는 포털이라 항상 마운트해 둔다. */
export function IssueBulkActions({
  projectKey,
  selected,
  onClear,
  onSettled,
  closedHiding,
}: {
  projectKey: string;
  /** 선택된 이슈 number 집합. */
  selected: Set<number>;
  /** 선택 해제(「선택 해제」 버튼). */
  onClear: () => void;
  /** 일괄 작업이 끝난 뒤 실패한 이슈 number — 호출 쪽이 그것만 선택에 남긴다(WP-851, 빈 배열이면 선택 해제). */
  onSettled: (failed: number[]) => void;
  /** 종료 이슈를 숨기는 목록 — 일괄 종료로 숨겨지는 이슈가 있으면 토스트로 알린다(WP-606). */
  closedHiding?: ClosedHidingNotice;
}) {
  const isMobile = useIsMobile();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // 모바일은 드롭다운(32px 항목) 대신 바텀 피커 시트로 고른다.
  const [picker, setPicker] = useState<'status' | 'assignee' | null>(null);
  const members = useProjectMembers(projectKey);
  // 상태 선택지(WP-869) — 프로젝트 상태 목록(서버 표시 순서). 일괄 바는 상태 목록 관문(ProjectStatusesGate) 안의
  // 목록에서만 그려져 목록이 늘 채워져 있다. 단일 프로젝트 화면에서만 쓰여 여러 프로젝트가 섞이는 경우는 없다.
  const statuses = useProjectStatusList(projectKey);
  const byCategory = statusesByCategory(statuses);
  const bulkStatus = useBulkUpdateStatus(projectKey, closedHiding);
  const bulkAssign = useBulkAssign(projectKey);
  const bulkDelete = useBulkDeleteIssues(projectKey);
  const qc = useQueryClient();
  const selectedNumbers = [...selected];
  // 모바일은 터치 타깃 44px 확보 + 눌림 피드백, 데스크톱은 기존 hover 밑줄 유지.
  // 색은 버튼별로 따로 지정한다(삭제는 text-destructive) — 공통 클래스에 넣으면 두 색이 충돌해 회색이 이긴다.
  const triggerBase = isMobile ? 'min-h-11 rounded-md px-3 active:bg-accent' : 'hover:underline';
  // WP-1019: 회색(muted-foreground) 글자는 muted 바 위에서 대비가 낮아 잘 안 보였다 — 본문색 + 중간 굵기로 또렷하게.
  const triggerCls = `${triggerBase} font-medium text-foreground`;
  const memberOptions = [
    { value: 'none', label: '미지정', icon: <UserPlus /> },
    // 비활성 구성원은 후보에서 뺀다(WP-487 — 서버가 새 지정을 거부).
    ...assigneeCandidates(members.data).map((m) => ({
      value: String(m.userId),
      label: m.name,
      icon: <UserAvatar user={{ id: m.userId, username: m.username, name: m.name }} size="xs" />,
      hint: m.kind === 'AGENT' ? <AgentBadge size="xs" /> : undefined,
    })),
  ];

  // 결과를 받아 실패한 이슈만 선택에 남긴다 — 부분 실패여도 mutation 은 성공(allSettled)으로 끝난다(WP-851).
  const settle = { onSuccess: (results: PromiseSettledResult<unknown>[]) => onSettled(failedOf(selectedNumbers, results)) };
  // 고른 상태로 옮긴다. 범주(status)는 종료 숨김 토스트 판정에 함께 넘긴다.
  function onBulkStatus(st: ProjectStatus) {
    bulkStatus.mutate({ numbers: selectedNumbers, status: st.category, statusId: st.id }, settle);
  }
  function onBulkAssign(userIds: number[]) {
    bulkAssign.mutate({ numbers: selectedNumbers, userIds }, settle);
  }
  function onBulkDeleteConfirm() {
    bulkDelete.mutate(selectedNumbers, settle);
    setConfirmDeleteOpen(false);
  }

  // 데스크톱 전용 드롭다운(기존 동작 그대로).
  const desktopMenus = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-testid="bulk-status-trigger" className={triggerCls}>
            상태 변경
          </button>
        </DropdownMenuTrigger>
        {/* 범주별 묶음(제목 = 범주 라벨) 아래 그 범주의 상태. 30자 이름도 메뉴가 화면을 넘지 않게 폭을 묶고 말줄임(title 로 전체).
            상태가 많아 길어지면 화면 끝에 붙지 않게 8px 띄운다(available-height 도 그만큼 줄어 안에서 스크롤, WP-809). */}
        <DropdownMenuContent align="start" collisionPadding={8} className="max-w-72">
          {ISSUE_STATUSES.filter((c) => byCategory[c].length > 0).map((c, i) => (
            <Fragment key={c}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup data-testid={`bulk-status-group-${c}`}>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {ISSUE_STATUS_LABEL[c]}
                </DropdownMenuLabel>
                {byCategory[c].map((st) => (
                  <DropdownMenuItem
                    key={st.id}
                    data-testid={`bulk-status-option-${st.id}`}
                    title={st.name}
                    onClick={() => onBulkStatus(st)}
                  >
                    <IssueStatusIcon status={st.category} color={st.color} decorative className="size-4" />
                    <span className="min-w-0 truncate">{st.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-testid="bulk-assignee-trigger" className={triggerCls}>
            담당자 지정
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem data-testid="bulk-assignee-option-unassign" onClick={() => onBulkAssign([])}>
            <UserPlus className="h-4 w-4" />
            미지정
          </DropdownMenuItem>
          {assigneeCandidates(members.data).map((m) => (
            <DropdownMenuItem
              key={m.userId}
              data-testid={`bulk-assignee-option-${m.userId}`}
              onClick={() => onBulkAssign([m.userId])}
            >
              <UserAvatar user={{ id: m.userId, username: m.username, name: m.name }} size="xs" />
              <span>{m.name}</span>
              {m.kind === 'AGENT' && <AgentBadge size="xs" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <>
      {/* WP-2065: 선택 개수 낭독 — 바 밖에 늘 마운트한다(바와 함께 생기거나 사라지는 영역은 낭독되지 않는다).
          개수를 조건 키로 넘겨 바뀔 때마다 비웠다 한 틱 뒤 채운다(ResultStatus). */}
      <ResultStatus
        conditionKey={String(selected.size)}
        ready
        text={bulkSelectionAnnouncement(selected.size)}
        testId="issue-bulk-status"
      />
      {selected.size > 0 && (
        <div
          // WP-2065: 이름 있는 묶음 — toolbar 는 화살표 키 이동을 약속하는데 이 바는 Tab 으로 옮겨 다녀 group 을 쓴다.
          role="group"
          aria-label="일괄 작업"
          data-testid="issue-bulk-toolbar"
          data-mobile={isMobile || undefined}
          onFocus={isMobile ? undefined : revealFocusedInBar}
          className={
            isMobile
              ? // 하단 탭바(--mobile-tabbar-h, MobileTabBar 가 공개) 바로 위에 고정 — 키보드가 열려 있으면 키보드 위.
                'fixed inset-x-0 z-40 flex items-center gap-1 border-t bg-popover text-popover-foreground px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] text-sm shadow-[0_-2px_8px_rgb(0_0_0/0.06)] bottom-[max(var(--mobile-tabbar-h,0px),var(--kb-inset,0px))]'
              : // 데스크톱은 스크롤 영역 위쪽에 붙어 있게(sticky) — 사이클 구간 목록처럼 바가 스크롤 영역 안에 있으면 아래에서 체크했을 때
                // 바가 화면 위쪽 밖(top -1590px)에 남아 선택 표시도 조작도 보이지 않았다(WP-485). 표 머리(z-10) 위에 그린다.
                // WP-2070: 이 높이(38px = py-2 16 + text-sm 줄 20 + 테두리 2)를 바꾸면 ProjectDetailPage 슬롯의 has-[[data-sticky-bulk-bar]]:scroll-pt-11(44px) 도 함께 고친다.
                // whitespace-nowrap — 좁은 lg 폭 + 옆 패널에서 단추 글자가 두 줄로 접히면 바가 약 58px 로 커져 44px 여백을 넘고 초점이 다시 가려졌다.
                // 한 줄을 지켜 높이를 38px 로 고정한다.
                // overflow-x-auto + 스크롤바 숨김(WP-2070) — 바보다 글자가 넓으면(에픽·AI 패널을 연 1024px 등) 넘친 단추를 바 안 가로 스크롤로 담는다.
                // 사이클 목록의 바 감싸개는 sticky left-0 w-[100cqw] 라 슬롯을 가로로 밀어도 바가 따라와 넘친 단추에 닿지 못했고, 넘친 글자가 바 배경 밖으로 나가 행과 겹쳤다.
                // Tab 으로 단추에 초점이 가면 revealFocusedInBar 가 바만 가로로 스크롤해 그 단추를 좌우 여백(px-3)과 함께 보여 준다(마우스는 가로 휠·트랙패드).
                // scroll-px-3 은 브라우저가 스스로 초점 스크롤할 때(단추가 통째로 가려진 경우)도 같은 여백을 두게 한다. 스크롤바를 숨기는 까닭은
                // 클래식 스크롤바(Windows 등)가 바 높이를 늘려 위 44px 여백을 넘기 때문이다.
                // *:scroll-mb-11(WP-2070) — 슬롯의 scroll-pt-11 은 바가 떠 있는 위 44px 를 「가려진 곳」으로 친다. 그러면 바 단추가 초점을 받을 때 브라우저가
                // 단추를 안 보인다고 보고 슬롯을 세로로 끌어올렸다(아래로 내린 목록이 맨 위 근처로 튐). 그래서 단추의 스크롤 기준 사각형을 위는 36px 줄이고(단추 위끝 9px → 45px)
                // 아래는 44px 늘려 슬롯의 보이는 영역(44px 아래) 안에 들게 한다 — 브라우저는 다 보인다고 보고 세로로는 움직이지 않는다. 가로는 그대로라 넘친 단추는 드러낸다.
                // 바 높이·여백(py-2·테두리)이나 슬롯 scroll-pt-11 을 바꾸면 이 값도 함께 고친다. 드롭다운 메뉴는 포털이라 이 overflow 에 잘리지 않는다.
                // WP-1019: 바탕은 불투명 popover(떠 있는 패널 표면) — 다크의 muted(흰 5% 알파)는 비쳐서 아래 목록 글자가 겹쳐 보였다. 테두리·그림자로 목록과 구분.
                `sticky top-0 z-20 mb-2 flex shrink-0 items-center gap-2 overflow-x-auto scroll-px-3 *:-scroll-mt-9 *:scroll-mb-11 ${HIDE_SCROLLBAR} whitespace-nowrap rounded border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm`
          }
        >
          {isMobile ? (
            <>
              {/* 텍스트 「완료」는 상태 「완료」와 헷갈려 ✕ 아이콘으로 — 왼쪽 끝. */}
              <button
                type="button"
                data-testid="bulk-clear"
                aria-label="선택 해제"
                onClick={onClear}
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground active:bg-accent"
              >
                <X className="size-5" aria-hidden />
              </button>
              <span className="px-1 font-medium">{selected.size}개 선택</span>
              <button type="button" data-testid="bulk-status-trigger" onClick={() => setPicker('status')} className={triggerCls}>
                상태 변경
              </button>
              <button type="button" data-testid="bulk-assignee-trigger" onClick={() => setPicker('assignee')} className={triggerCls}>
                담당자 지정
              </button>
            </>
          ) : (
            <>
              <span>선택 {selected.size}개</span>
              {desktopMenus}
            </>
          )}
          <button
            type="button"
            data-testid="bulk-delete"
            onClick={() => setConfirmDeleteOpen(true)}
            className={`${triggerBase} text-destructive ${isMobile ? 'ml-auto' : ''}`}
          >
            삭제
          </button>
          {!isMobile && (
            <button type="button" data-testid="bulk-clear" onClick={onClear} className={`${triggerCls} ml-auto`}>
              선택 해제
            </button>
          )}
        </div>
      )}

      {isMobile && (
        <>
          <MobilePickerSheet
            testId="bulk-status-picker"
            open={picker === 'status'}
            onClose={() => setPicker(null)}
            title="상태 변경"
            value={null}
            // 프로젝트 상태(값 = statusId, 표시 순서라 범주끼리 모여 있고 아이콘 모양이 범주) — 이슈 상태 시트와 같은 모양.
            options={statusPickerOptions(statuses)}
            // 30자 이름은 한 줄 말줄임이면 앞부분만 같은 상태를 구별하지 못한다 — 두 줄까지.
            wrapLabels
            onSelect={(v) => {
              const st = findStatus(statuses, v);
              if (st) onBulkStatus(st);
            }}
          />
          <MobilePickerSheet
            testId="bulk-assignee-picker"
            open={picker === 'assignee'}
            onClose={() => setPicker(null)}
            title="담당자 지정"
            searchable={memberOptions.length > 8}
            value={null}
            options={memberOptions}
            onSelect={(v) => onBulkAssign(v === 'none' ? [] : [Number(v)])}
          />
        </>
      )}

      {/* #606: 벌크 삭제 확인 — IssueDetailPage 단건 삭제와 동일한 제어형 AlertDialog 패턴. */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent data-testid="issue-bulk-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>이슈 일괄 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              {/* WP-482: 부모를 지우면 하위도 함께 지워진다 — 단건 확인창처럼 그 수를 알린다(행은 화면에 있으니 검색 캐시에서 찾는다). */}
              {bulkDeleteDescription(
                selected.size,
                countCascadedChildren(selectedNumbers.map((n) => findIssueInSearchCache(qc, projectKey, n))),
              )}
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
