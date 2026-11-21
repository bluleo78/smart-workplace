// src/components/layout/InboxList.tsx
// 인박스 목록 — 데스크톱 Popover(InboxPanel)와 모바일 /notifications 화면이 공유한다(WP-126).
// 헤더(모두 읽음·읽은 알림 보관) + 푸시 유도 배너 + 무한스크롤 목록. 기존 testid 를 그대로 유지한다.
import { Archive, Bell, CheckCheck } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  isCalendarType,
  isMailSendFailedType,
  isOAuthAppConnectedType,
  isPersonalAssistantRevokedType,
  isWikiShareType,
  mailSendFailedLabel,
  notifTarget,
} from "@/components/home/notifTarget";
import {
  focusInboxList,
  INBOX_SCROLL_TESTID,
} from "@/components/layout/inboxFocus";
import { PushPromptBanner } from "@/components/layout/PushPromptBanner";
import { LoadErrorState } from "@/components/LoadErrorState";
import { narrowHeaderActionClass } from "@/components/mobile/headerClass";
import { MobileEmptyState } from "@/components/mobile/MobileEmptyState";
import { Button } from "@/components/ui/button";
import { LoadMoreFooter } from "@/components/ui/load-more-footer";
import { AgentActorBadge } from "@/components/users/AgentBadge";
import { useArchiveReadNotifications } from "@/hooks/queries/useArchiveReadNotifications";
import { useMarkAllNotificationsRead } from "@/hooks/queries/useMarkAllNotificationsRead";
import { useMarkNotificationRead } from "@/hooks/queries/useMarkNotificationRead";
import {
  flattenNotificationPages,
  useArchivedNotifications,
  useNotifications,
} from "@/hooks/queries/useNotifications";
import {
  useUnarchiveNotification,
  useUnarchivingIds,
} from "@/hooks/queries/useUnarchiveNotification";
import { useUnreadCount } from "@/hooks/queries/useUnreadCount";
import { useListFocusRescue } from "@/hooks/useListFocusRescue";
import { focusLost } from "@/hooks/useRestoreFocusOnExit";
import { formatDateTimeMinute, formatRelativeTime } from "@/lib/formatters";
import {
  notificationAction,
  PERSONAL_ASSISTANT_REVOKED_NO_ACTOR,
} from "@/lib/notifText";
import { showsLoadError } from "@/lib/queryFailure";
import { cn } from "@/lib/utils";
import type { NotificationResponse } from "@/types/notification";

/**
 * 노트 공유 알림 문구(WP-579) — 행위자 이름 뒤에 붙는 부분. 접근 승인은 행위자 없이 노트 기준 문구만 쓴다.
 * 공유받음 "{actor}님이 노트 「{title}」을 공유했습니다", 접근 요청 "{actor}님이 「{title}」 접근을 요청했습니다",
 * 접근 승인 "「{title}」 접근이 승인됐습니다".
 */
function wikiShareText(n: NotificationResponse): string {
  const title = n.wikiPageTitle ?? "노트";
  if (n.type === "WIKI_SHARED") return `님이 노트 「${title}」을 공유했습니다`;
  if (n.type === "WIKI_SHARE_ACCESS_REQUESTED")
    return `님이 「${title}」 접근을 요청했습니다`;
  return `「${title}」 접근이 승인됐습니다`;
}

/**
 * 「읽은 알림 보관」 활성 판정(WP-1689) — 지금 받아 둔 목록(불러온 페이지들)에 읽은 알림이 하나라도 있는가.
 * 안 읽은 수와는 무관하다(모두 읽음과 반대 조건). 목록 밖 페이지까지 세지 않는 것은 의도 — 맨 앞 페이지가 모두 안 읽음이면
 * 그 뒤의 읽은 알림은 화면에 보이지 않으므로 치울 것이 눈에 띄지 않는다.
 */
function hasReadNotification(items: NotificationResponse[]): boolean {
  return items.some((n) => n.read);
}

/** 알림 창 보기 — 받은 알림(inbox) 또는 보관함(archive)(WP-1690). */
export type InboxView = "inbox" | "archive";

/** 보기 탭이 가리키는 패널(목록 영역)의 id — 탭의 aria-controls 와 패널의 id 가 같은 값을 쓴다(WP-1843). */
// 이 파일 안(탭·목록)에서만 쓴다 — 컴포넌트 파일에서 컴포넌트가 아닌 것을 내보내면 Fast Refresh 가 전체 새로고침이 된다.
const INBOX_VIEW_PANEL_ID = "inbox-view-panel";

/** 알림 행 표식 — 포커스 복구 훅의 행 선택자. 채팅 메시지 표식(data-message-id)과 겹치지 않게 따로 둔다(WP-1845). */
const INBOX_ROW_SELECTOR = "[data-inbox-row-id]";

/** 보기 탭 단추의 id — 패널의 aria-labelledby 가 가리킨다(WP-1843). */
function inboxViewTabId(v: InboxView): string {
  return `inbox-view-tab-${v}`;
}

/** 보기 탭 목록(순서 = 방향키 이동 순서). 렌더마다 새로 만들 필요가 없어 모듈에 둔다. */
const VIEW_TABS: { id: InboxView; label: string }[] = [
  { id: "inbox", label: "알림" },
  { id: "archive", label: "보관함" },
];

/**
 * 「알림 | 보관함」 전환 탭(WP-1690) — 데스크톱 제목 줄과 모바일 /notifications 가 함께 쓴다.
 * 선택 탭은 굵게·밑줄로 구분하고 aria-selected 로 알린다.
 * WP-1843: APG Tabs 패턴 — roving tabindex(선택 탭만 Tab 정지점), ←/→(감김)·Home·End 로 초점 이동과 동시에 선택(자동 활성화).
 */
export function InboxViewTabs({
  view,
  onChange,
}: {
  view: InboxView;
  onChange: (v: InboxView) => void;
}) {
  // 탭 단추 ref — 방향키로 정해진 탭에 초점을 옮기는 데 쓴다.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 보관함 빈 상태 CTA(「받은 알림 보기」)로 받은 알림에 돌아오면 눌린 버튼이 사라져 포커스가 body 로 떨어진다(WP-1848).
  // 탭을 그리는 이 컴포넌트가 직접 처리한다 — 보기가 보관함에서 받은 알림으로 바뀐 뒤 포커스가 body 에 있으면(= 포커스를 가졌던
  // 요소가 사라졌으면) 이 탭(받은 탭 = 첫 탭)으로 옮긴다. 탭을 직접 눌러 바꾼 경우엔 포커스가 이미 탭에 있어 건드리지 않는다.
  // 탭이 InboxList 안(팝오버)이든 밖(모바일 헤더)이든 호출부가 할 일이 없고, id 로 찾지 않고 이 컴포넌트의 ref 만 쓰므로 두 모양이 함께 떠도 각자 자기 탭만 옮긴다.
  const prevView = useRef(view);
  useEffect(() => {
    const cameBackFromArchive = prevView.current === "archive" && view === "inbox";
    prevView.current = view;
    if (!cameBackFromArchive) return;
    const active = document.activeElement;
    if (!active || active === document.body) tabRefs.current[0]?.focus();
  }, [view]);
  /** 방향키·Home·End 처리. 수식키(Shift 포함)가 눌렸거나 대상 키가 아니면 건드리지 않는다. */
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const n = VIEW_TABS.length;
    // 기준은 초점이 있는 탭 — 보조기기·스크립트가 선택되지 않은 탭에 초점을 두었어도 그 자리에서 움직인다.
    // 초점 탭을 못 찾으면(tablist 자체 등) 선택 탭을 기준으로 한다.
    const focused = tabRefs.current.findIndex((el) => el === e.target);
    const current =
      focused >= 0 ? focused : VIEW_TABS.findIndex((t) => t.id === view);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? n - 1
          : (current + (e.key === "ArrowRight" ? 1 : n - 1)) % n; // ←/→ 는 끝에서 감긴다
    e.preventDefault();
    tabRefs.current[next]?.focus();
    // 같은 탭이면 전환 알림을 보내지 않는다.
    if (VIEW_TABS[next].id !== view) onChange(VIEW_TABS[next].id);
  };

  return (
    <div
      role="tablist"
      aria-label="알림 보기"
      className="flex items-center gap-3"
      onKeyDown={handleKeyDown}
    >
      {VIEW_TABS.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            tabRefs.current[i] = el;
          }}
          // id: 패널의 aria-labelledby 용(WP-1843). 포커스 이동(WP-1848)은 id 가 아니라 ref 를 쓴다.
          id={inboxViewTabId(t.id)}
          type="button"
          role="tab"
          aria-selected={view === t.id}
          aria-controls={INBOX_VIEW_PANEL_ID}
          tabIndex={view === t.id ? 0 : -1}
          data-testid={`inbox-tab-${t.id}`}
          onClick={() => onChange(t.id)}
          className={cn(
            "shrink-0 whitespace-nowrap border-b-2 pb-0.5 text-sm",
            view === t.id
              ? "border-foreground font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 인박스 목록 본체.
 * @param enabled 조회 활성 여부(Popover 는 열렸을 때만 조회)
 * @param onNavigate 행 클릭 후 이동 직전에 호출(Popover 닫기 등). 닫을 것이 없는 화면(모바일 /notifications)은 생략
 * @param scrollClassName 스크롤 영역 클래스(모바일 페이지는 'min-h-0 flex-1 overflow-y-auto')
 * @param hideHeader 자체 제목 행('알림' + 모두 읽음 + 읽은 알림 보관) 숨김 — 모바일 /notifications 는 화면 헤더가 제목을 갖고
 *   '모두 읽음'·'읽은 알림 보관' 은 헤더 액션 자리(MarkAllReadButton·ArchiveReadButton)로 옮겨 별도 한 줄을 쓰지 않는다(U1-7).
 * @param screenEmpty 빈 상태를 전체 화면 규격으로(모바일 /notifications, U3-R11)
 * @param view 보기(알림|보관함) — 항상 바깥이 들고 내려준다(WP-1690)
 * @param onViewChange 보기 전환 알림
 */
export function InboxList({
  enabled,
  onNavigate,
  scrollClassName = "max-h-96 overflow-y-auto",
  hideHeader = false,
  screenEmpty = false,
  view,
  onViewChange,
}: {
  enabled: boolean;
  onNavigate?: () => void;
  scrollClassName?: string;
  hideHeader?: boolean;
  /** 빈 상태를 전체 화면 규격(MobileEmptyState)으로 — 모바일 /notifications 전용. 데스크톱 Popover 는 기존 작은 빈 상태. */
  screenEmpty?: boolean;
  view: InboxView;
  onViewChange: (v: InboxView) => void;
}) {
  const isArchive = view === "archive";
  // 빈 상태 문구 — 보기에 따라 한 번만 정한다(전체 화면·팝오버 두 모양이 함께 쓴다).
  const emptyTitle = isArchive ? "보관한 알림이 없습니다" : "새 알림이 없습니다";
  const emptyDesc = isArchive
    ? "보관한 알림이 여기에 표시됩니다."
    : "이슈 배정, 코멘트, 상태 변경 알림이 여기에 표시됩니다.";
  const navigate = useNavigate();
  // 닫고 이동하는 순서를 한 곳에 — 팝오버면 먼저 닫고(onNavigate) 대상으로 간다. 행 클릭·빈 상태 CTA 가 함께 쓴다.
  const goTo = (path: string) => {
    onNavigate?.();
    navigate(path);
  };
  // 빈 상태 CTA — 막다른 길을 없애려고 보기별 다음 행동을 하나 둔다(WP-1848).
  // 보관함: 받은 알림으로 돌아가기 / 받은 탭: 알림이 안 오는 이유를 찾을 수 있는 알림 설정으로 이동.
  const emptyActionLabel = isArchive ? "받은 알림 보기" : "알림 설정";
  const onEmptyAction = () => {
    if (isArchive) {
      onViewChange("inbox");
    } else {
      goTo("/settings/notifications");
    }
  };
  const { data: unread = 0 } = useUnreadCount();
  // 두 목록 모두 훅은 늘 부르되 보고 있는 쪽만 조회한다(enabled).
  const inboxQuery = useNotifications(enabled && !isArchive);
  const archiveQuery = useArchivedNotifications(enabled && isArchive);
  const query = isArchive ? archiveQuery : inboxQuery;
  const { data, isLoading } = query;
  // 보기별 실패 문구 — 보관함에서 실패하면 받은 알림이 아니라 보관한 알림을 못 불러온 것이다(WP-1847).
  const loadErrorTitle = isArchive
    ? "보관한 알림을 불러오지 못했습니다"
    : "알림을 불러오지 못했습니다";
  // 페이지가 바뀔 때만 새 배열 — 포커스 복구 훅의 효과가 렌더마다 돌지 않게 한다(WP-1845).
  const items = useMemo(
    () => flattenNotificationPages(data?.pages),
    [data?.pages],
  );
  const unarchive = useUnarchiveNotification();
  // 요청이 진행 중인 줄 id 들 — 뮤테이션 캐시에서 모든 진행 중 호출을 읽는다(마지막 호출만 보면 앞 줄 잠금이 일찍 풀린다, WP-1845).
  // 성공한 줄은 훅이 끝나기 전에 캐시에서 빼므로 잠금이 풀릴 때 이미 목록에 없다(까닭은 useUnarchiveNotification 주석).
  const pendingIds = useUnarchivingIds();
  // 그 줄을 되돌리는 중인지 — 클릭 무시와 aria-disabled 가 같은 판정을 쓴다.
  const isUnarchiving = (id: number) => pendingIds.includes(id);
  /**
   * 한 줄을 되돌린다. 여러 줄을 함께 누를 수 있어 호출마다 따로 끝나는 mutateAsync 를 쓴다.
   * 실패 안내는 훅의 onError 토스트가 맡으니 여기서는 거부를 삼키기만 한다.
   */
  const startUnarchive = (id: number) => {
    unarchive.mutateAsync(id).catch(() => {});
  };
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const archiveRead = useArchiveReadNotifications();

  // 스크롤 컨테이너 — 공용 LoadMoreFooter 의 sentinel 이 이 칸을 root 로 바닥 근처를 본다(WP-1848).
  // 객체 ref 가 아니라 state 인 이유: 마운트 뒤 값이 정해져야 footer 가 root 를 받아 observer 를 만든다(ReactorsPanel 과 같은 방식).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  // 직전 커밋의 보기 — 아래 복구 fallback 이 「보기가 방금 바뀌었는가」를 판단하는 데 쓴다. 복구 훅의 효과 뒤(선언 순서)에 갱신한다.
  const committedView = useRef(view);
  /**
   * 행이 모두 빠졌을 때(하나뿐인 행을 되돌림) 복구 훅이 포커스를 둘 곳 — 이 인스턴스의 목록 영역(tabpanel)(WP-1845).
   * 패널은 늘 tabIndex 가 있어(불러오는 중이면 0, 그 밖에는 -1 — WP-1843) -1 이어도 프로그램 포커스는 받으므로 훅이 그대로 focus() 하면 된다.
   * 보기가 방금 바뀐 커밋에서는 null — 보관함 빈 상태 CTA(「받은 알림 보기」)로 사라진 버튼의 포커스는 InboxViewTabs 가 받은 탭으로
   * 옮긴다(WP-1848). 여기서 패널로 먼저 옮기면, 탭이 InboxList 밖(모바일 머리)에 있어 그 효과가 나중에 돌 때 body 가 아니라서
   * 탭으로 가지 못한다. 보기 전환으로 생긴 포커스 잃음은 탭이, 같은 보기 안에서 행이 빠진 것은 이 훅이 맡는다.
   */
  const rescueFallback = useCallback(
    () => (committedView.current === view ? scrollEl : null),
    [view, scrollEl],
  );
  // 되돌리기로 행이 빠지면 포커스를 같은 자리 행(마지막이었으면 앞 행), 남은 행이 없으면 목록 영역으로 옮긴다(WP-1845).
  // 채팅·코멘트 목록과 같은 공용 훅(WP-832)을 쓴다. 목록 요소는 <ul> 이 아니라 스크롤 영역이다 — 마지막 행이 빠지면 <ul> 자체가
  // 빈 상태로 바뀌어 사라지므로, 거기 달면 훅이 목록을 잃어 fallback 까지 가지 못한다.
  const setRescueList = useListFocusRescue(items, rescueFallback, INBOX_ROW_SELECTOR);
  // 복구 훅의 효과가 이번 커밋의 보기 비교를 마친 뒤 갱신한다(같은 컴포넌트의 효과는 선언 순서대로 돈다).
  useEffect(() => {
    committedView.current = view;
  }, [view]);
  // 스크롤 영역 하나에 두 ref 를 단다 — footer root(state)와 복구 훅의 목록. 참조가 안정적이어야 렌더마다 null→요소로 다시 불리지 않는다.
  const scrollAreaRef = useCallback(
    (el: HTMLDivElement | null) => {
      setScrollEl(el);
      setRescueList(el);
    },
    [setRescueList],
  );

  // 행 클릭: (보관함이 아니고) 안읽음이면 읽음 처리 → onNavigate(패널 닫기 등) → 대상으로 이동.
  // 딥링크 규칙은 notifTarget() 공용 유틸과 동일(캘린더 알림→캘린더, 식별정보 없으면 인박스 대용 폴백).
  const onRowClick = (n: NotificationResponse) => {
    if (!isArchive && !n.read) markRead.mutate(n.id);
    goTo(notifTarget(n));
  };

  // 빈 상태 CTA 버튼 — 전체 화면(터치 규격)·팝오버(작은 윤곽선)가 크기·모양만 달리 같은 요소를 쓴다.
  // key={view}: 두 보기의 빈 상태가 같은 자리에 같은 버튼을 그려 React 가 DOM 버튼을 재사용하면, 눌린 버튼이 언마운트되지 않아
  // 포커스가 body 로 떨어지지 않고 이름만 「알림 설정」으로 바뀐 그 버튼에 남는다(WP-1848 라이브 검증 회귀).
  // 보기별 key 로 다시 마운트시켜 포커스를 잃게 하고, 그러면 InboxViewTabs 가 받은 탭으로 옮긴다.
  const emptyActionButton = (
    <Button
      key={view}
      size={screenEmpty ? "default" : "sm"}
      variant={screenEmpty ? "default" : "outline"}
      className={screenEmpty ? "h-11 px-5" : undefined}
      data-testid="inbox-empty-action"
      onClick={onEmptyAction}
    >
      {emptyActionLabel}
    </Button>
  );

  // 조회 실패 안내를 그릴지 — 일부 페이지를 이미 받아 행이 있으면 목록을 유지한다(WP-1848). 패널 Tab 정지점도 이것으로 가른다.
  const loadFailed = showsLoadError(query) && items.length === 0;

  return (
    <>
      {!hideHeader && (
        <div className="flex items-center border-b px-3 py-2 justify-between">
          {/* 제목 자리는 「알림 | 보관함」 전환(WP-1690) — 선택 탭이 제목 역할을 한다. */}
          <InboxViewTabs
            view={view}
            onChange={onViewChange}
          />
          {/* 오른쪽 묶음: 모두 읽음 · 읽은 알림 보관(WP-1689). 보관함에서는 대상이 없어 숨긴다. 줄마다 보관 단추는 두지 않는다. */}
          {!isArchive && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="inbox-mark-all"
                // 알림 없거나 모두 읽음 상태면 비활성화, 처리 중이면 aria-disabled(markAllButtonProps).
                {...markAllButtonProps(markAll, items.length === 0 || unread === 0)}
                className="text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              >
                모두 읽음
              </button>
              <button
                type="button"
                data-testid="inbox-archive-read"
                onClick={() => archiveRead.mutate()}
                // 받은 목록에 읽은 알림이 하나도 없거나 처리 중이면 비활성화(서버는 목록 밖의 읽은 알림까지 모두 보관한다)
                disabled={!hasReadNotification(items) || archiveRead.isPending}
                className="text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                읽은 알림 보관
              </button>
            </div>
          )}
        </div>
      )}
      {/* 푸시 유도 배너는 받은 알림 보기에서만 */}
      {!isArchive && <PushPromptBanner />}
      {/*
        WP-1843: 목록 영역은 선택 탭(inboxViewTabId)에 이어진 tabpanel 이다(APG Tabs).
        모바일은 탭이 화면 머리에 따로 있고 목록은 별도 컴포넌트라, 같은 파일의 고정 id 로 탭과 패널을 잇는다.
        Tab 정지점은 불러오는 중일 때만 패널이 된다(tabIndex 0, APG: 안에 초점 받을 것이 없을 때만).
        조회 실패(다시 시도)·빈 상태(CTA)·행 목록에는 안에 초점 받을 단추가 있어 -1 로 둔다 — 정지점이 하나 더 생기지 않게(WP-1843 리뷰 후속).
        속성을 아예 빼지 않고 -1 로 두는 까닭: 로딩 중 패널에 둔 초점이 행 도착 때 body 로 떨어지지 않게 프로그램 초점은 유지한다(WP-1843).
      */}
      <div
        role="tabpanel"
        id={INBOX_VIEW_PANEL_ID}
        aria-labelledby={inboxViewTabId(view)}
        // 불러오는 중일 때만 Tab 정지점(WP-1843) — 빈 목록·조회 실패는 안의 CTA·다시 시도 단추가 정지점이다.
        // -1 이어도 프로그램 포커스는 받으므로, 행이 모두 빠지거나 모두 읽음 뒤 포커스 복구의 도착지로 쓴다(WP-1845).
        tabIndex={isLoading && !loadFailed ? 0 : -1}
        // footer root + 포커스 복구 훅의 목록(WP-1845)
        ref={scrollAreaRef}
        data-testid={INBOX_SCROLL_TESTID}
        className={scrollClassName}
      >
        {loadFailed ? (
          // 조회 실패 — 빈 상태로 보이면 「알림 설정」 문제로 오해하므로 공용 실패 안내(다시 시도)를 보인다(WP-1848).
          // 불러오는 중보다 먼저 본다 — 다시 부르는 동안에도 안내를 두어야 초점이 body 로 사라지지 않는다(lib/queryFailure).
          <LoadErrorState
            variant="inline"
            title={loadErrorTitle}
            queries={[query]}
            testId="inbox-error"
          />
        ) : isLoading ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            불러오는 중…
          </p>
        ) : items.length === 0 && screenEmpty ? (
          // 모바일 전체 화면: 메일 계정 없음과 같은 공용 빈 상태 규격(U3-R11).
          <MobileEmptyState
            data-testid="inbox-empty"
            className="h-full"
            icon={Bell}
            title={emptyTitle}
            description={emptyDesc}
            action={emptyActionButton}
          />
        ) : items.length === 0 ? (
          // 빈 상태: 아이콘 + 제목 + 설명 + CTA (디자인 시스템 §2.5 Empty State 4요소, WP-1848)
          <div
            data-testid="inbox-empty"
            className="flex flex-col items-center gap-2 px-3 py-8 text-center text-muted-foreground"
          >
            <Bell className="h-8 w-8 opacity-30" />
            <p className="text-sm font-medium">{emptyTitle}</p>
            <p className="text-xs">{emptyDesc}</p>
            <div className="mt-2">{emptyActionButton}</div>
          </div>
        ) : (
          <>
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  // data-inbox-row-id: 포커스 복구 훅(useListFocusRescue)의 행 표식 — 행이 빠지면 같은 자리 행으로 포커스를 옮긴다(WP-1845).
                  // data-message-id 를 쓰지 않는다 — 메시지 링크 이동(useMessageLinkJump)이 문서 전체에서 그 표식을 찾아, 알림 창이 열려
                  // 있으면 같은 id 의 알림 행이 실제 메시지 대신 강조된다.
                  data-inbox-row-id={n.id}
                  className={cn(isArchive && "flex items-stretch")}
                >
                  <button
                    type="button"
                    data-testid="inbox-item"
                    onClick={() => onRowClick(n)}
                    // WP-1844: relative — 안의 sr-only(absolute)가 스크롤 영역 밖 기준으로 잡혀 페이지 넘침을 만들지 않게 한다.
                    className={cn(
                      "relative flex w-full min-w-0 items-start gap-2 row-divider px-3 py-2 text-left text-sm hover:bg-accent/50",
                      !n.read && "bg-accent/20",
                    )}
                  >
                    {/* WP-1844: 안 읽음을 파란 점(색)으로만 알리면 스크린 리더가 구분하지 못한다 —
                        행 이름 맨 앞에 보이지 않는 「읽지 않음, 」을 넣는다(읽은 행은 넣지 않는다). */}
                    {!n.read && <span className="sr-only">읽지 않음, </span>}
                    <span className="min-w-0 flex-1">
                      {n.type === "REMINDER" ? (
                        // 일정 리마인더 — 액터 없이 일정 제목 + 시작 시각 표시.
                        <>
                          <span className="font-medium">일정 알림</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {n.eventTitle} ·{" "}
                            {formatDateTimeMinute(n.eventStartsAt)}
                          </span>
                        </>
                      ) : isPersonalAssistantRevokedType(n) ? (
                        // 개인 비서 연결 해제(WP-1170) — 이슈 줄 없이 문구만. 행위자(관리자)가 있으면 이름 + 동작 문구,
                        // 없으면(일회성 정리) 「시스템님이」로 읽히지 않게 행위자 없는 문구.
                        n.actorName ? (
                          <>
                            <span className="font-medium">{n.actorName}</span>
                            <AgentActorBadge
                              kind={n.actorKind}
                              className="ml-1 align-middle"
                            />
                            <span className="text-muted-foreground">
                              {notificationAction(n)}
                            </span>
                          </>
                        ) : (
                          <span className="font-medium">
                            {PERSONAL_ASSISTANT_REVOKED_NO_ACTOR}
                          </span>
                        )
                      ) : isOAuthAppConnectedType(n) ? (
                        // 새 앱 연결(WP-1686) — 행위자·이슈 줄 없이 앱 이름(message)과 끊기 안내만. 내가 한 일이 아니면 바로 끊게 한다.
                        <>
                          <span className="font-medium">
                            {n.message
                              ? `${notificationAction(n)} — ${n.message}`
                              : notificationAction(n)}
                          </span>
                          {/* 끊는 곳을 알려 주는 안내라 좁은 화면에서도 끝까지 보이게 한 줄 말줄임 대신 두 줄까지 감싼다(line-clamp 가 블록 상자를 만든다). */}
                          <span className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
                            내가 연결하지 않았다면 설정 › API 토큰에서 끊어
                            주세요
                          </span>
                        </>
                      ) : isMailSendFailedType(n) ? (
                        // 메일 보내기 실패(WP-1786) — 행위자·이슈 줄 없이 상태 문구(보내지 못함 / 보냈는지 확인하지 못함)와 메일 제목만.
                        // 누르면 그 임시보관을 쓰기 창으로 연다(notifTarget).
                        <>
                          <span
                            data-testid="inbox-mail-send-failed"
                            className="font-medium"
                          >
                            {notificationAction(n)}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {mailSendFailedLabel(n)}
                          </span>
                        </>
                      ) : isWikiShareType(n) ? (
                        // 노트 공유 알림(WP-579) — 문구에 노트 제목이 들어간다. 공유받음은 보낸 사람의 메시지를 한 줄 더 보인다.
                        <>
                          {n.type === "WIKI_SHARE_ACCESS_APPROVED" ? (
                            <span className="font-medium">
                              {wikiShareText(n)}
                            </span>
                          ) : (
                            <>
                              <span className="font-medium">
                                {n.actorName ?? "시스템"}
                              </span>
                              <AgentActorBadge
                                kind={n.actorKind}
                                className="ml-1 align-middle"
                              />
                              <span className="text-muted-foreground">
                                {wikiShareText(n)}
                              </span>
                            </>
                          )}
                          {n.type === "WIKI_SHARED" && n.message && (
                            <span
                              data-testid="inbox-wiki-message"
                              className="mt-0.5 block truncate text-xs text-muted-foreground"
                            >
                              {n.message}
                            </span>
                          )}
                        </>
                      ) : isCalendarType(n) ? (
                        // 일정 초대/RSVP 변경 — 액터 + 동작 문구 + 일정 제목·시작 시각 표시(#489, #585).
                        <>
                          <span className="font-medium">
                            {n.actorName ?? "시스템"}
                          </span>
                          <AgentActorBadge
                            kind={n.actorKind}
                            className="ml-1 align-middle"
                          />
                          <span className="text-muted-foreground">
                            {notificationAction(n)}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {n.eventTitle} ·{" "}
                            {formatDateTimeMinute(n.eventStartsAt)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">
                            {n.actorName ?? "시스템"}
                          </span>
                          <AgentActorBadge
                            kind={n.actorKind}
                            className="ml-1 align-middle"
                          />
                          <span className="text-muted-foreground">
                            {notificationAction(n)}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {n.projectKey}-{n.issueNumber} {n.issueTitle}
                          </span>
                        </>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                    {!n.read && (
                      // WP-1844: 장식용 점 — 의미는 위 sr-only 문구가 전달하므로 보조기기에서 숨긴다.
                      <span
                        aria-hidden="true"
                        data-testid="inbox-unread-dot"
                        className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary"
                      />
                    )}
                  </button>
                  {isArchive && (
                    // 보관함 줄 단추 — 줄 버튼 안에 넣을 수 없어 형제로 둔다(버튼 안 버튼 금지). 이동 없이 그 id 만 되돌린다.
                    <button
                      type="button"
                      data-testid="inbox-unarchive"
                      onClick={(e) => {
                        e.stopPropagation();
                        // 처리 중인 그 줄은 클릭을 무시한다(aria-disabled). 행이 빠진 뒤 포커스는 목록의 포커스 복구 훅이 옮긴다.
                        if (isUnarchiving(n.id)) return;
                        startUnarchive(n.id);
                      }}
                      // 처리 중인 그 줄만 막는다 — 전체를 막으면 한 줄 되돌리는 동안 다른 줄 클릭이 소리 없이 무시된다.
                      // native disabled 대신 aria-disabled 로 잠근다 — 실패해 줄이 남으면 포커스가 이 버튼에 그대로 있게(WP-1845).
                      aria-disabled={isUnarchiving(n.id) || undefined}
                      className="shrink-0 row-divider px-3 text-xs text-primary hover:bg-accent/50 aria-disabled:opacity-50"
                    >
                      되돌리기
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {/* 다음 페이지 — 공용 푸터가 바닥 근처에서 자동 로드·「불러오는 중…」·실패 시 다시 시도를 맡는다(WP-1848).
              실패하면 안내 없이 목록이 끝나 「끝」으로 오인되지 않고, 실패 중에는 자동 로드가 멈춘다. <ul> 밖에 둔다(div 라서). */}
            <LoadMoreFooter
              query={query}
              root={scrollEl}
              errorLabel="더 불러오지 못했습니다 — 다시 시도"
              data-testid="inbox-next-page"
            />
          </>
        )}
      </div>
    </>
  );
}

/**
 * 모두 읽음을 실행하고, 성공하면 포커스를 알림 목록 영역으로 옮긴다(WP-1845).
 * 성공 뒤 안 읽음이 0 이 되어 버튼이 native disabled 가 되면 포커스가 BODY 로 떨어져 키보드·스크린리더 사용자가 위치를 잃기 때문이다.
 * 처리 중에는 aria-disabled 라 클릭을 무시한다 — 연속 호출이 없으니 호출별 onSuccess 가 덮이지 않고, 실패 땐 포커스가 버튼에 그대로 남는다.
 * 옮기는 조건: 포커스가 갈 곳을 잃었거나(focusLost), 아직 누른 버튼에 있는데 그 버튼이 실제로 native disabled 가 됐을 때
 * (비활성 요소에서 포커스를 빼지 않는 브라우저·jsdom). 그 사이 새 안 읽음이 와서 버튼이 여전히 눌리면 포커스를 버튼에 둔다 —
 * 멀쩡한 컨트롤에서 포커스를 빼앗지 않는다. aria-disabled 는 이 버튼에서 「처리 중」만 뜻하고 성공 뒤엔 풀리므로 판정에 넣지 않는다.
 * 처리 중 사용자가 다른 곳으로 옮겼으면 빼앗지 않는다.
 */
function markAllAndRefocus(markAll: ReturnType<typeof useMarkAllNotificationsRead>, trigger: HTMLButtonElement) {
  if (markAll.isPending) return;
  markAll.mutate(undefined, {
    // rAF 한 번 + 매크로태스크 한 번 뒤 — React 가 안 읽음 0 으로 다시 그려 버튼이 비활성이 된 DOM 을 보고 판단한다.
    // rAF 만으로는 재조회 결과의 커밋보다 먼저 돌 수 있어(jsdom 에서 확인) 버튼이 아직 활성으로 보인다 — 그러면 비활성 여부를
    // 잘못 읽어 포커스를 옮기지 못한다. 그 뒤 태스크로 한 번 더 미뤄 커밋된 DOM 을 본다.
    onSuccess: () =>
      requestAnimationFrame(() =>
        setTimeout(() => {
          const disabledTrigger = document.activeElement === trigger && trigger.disabled;
          if (focusLost() || disabledTrigger) focusInboxList();
        }, 0),
      ),
  });
}

/**
 * 두 「모두 읽음」 버튼(제목 행·모바일 머리)이 함께 쓰는 잠금·클릭 속성 — 규칙을 한 곳에 둔다(WP-1845).
 * 대상 없음(알림 없음·안 읽음 0)은 native disabled, 처리 중은 aria-disabled(native disabled 는 브라우저가 포커스를 빼서
 * 실패 뒤 포커스가 BODY 에 남는다 — useRestoreFocusOnExit 와 같은 규칙).
 */
function markAllButtonProps(markAll: ReturnType<typeof useMarkAllNotificationsRead>, nothingToRead: boolean) {
  return {
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => markAllAndRefocus(markAll, e.currentTarget),
    disabled: nothingToRead,
    "aria-disabled": markAll.isPending || undefined,
  };
}

/**
 * 모바일 알림 화면 헤더용 '모두 읽음' — InboxList 제목 행의 버튼과 같은 규칙(알림 없음·모두 읽음이면 비활성, 처리 중이면 aria-disabled)·testid.
 * 목록과 같은 쿼리 키를 쓰므로 추가 요청 없이 캐시를 공유한다.
 */
export function MarkAllReadButton() {
  const { data: unread = 0 } = useUnreadCount();
  const { data } = useNotifications(true);
  const items = flattenNotificationPages(data?.pages);
  const markAll = useMarkAllNotificationsRead();
  return (
    <button
      type="button"
      data-testid="inbox-mark-all"
      {...markAllButtonProps(markAll, items.length === 0 || unread === 0)}
      title="모두 읽음"
      className={cn(
        narrowHeaderActionClass,
        "aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground aria-disabled:opacity-60",
      )}
    >
      {/* WP-1731: 360px 미만은 아이콘만 보이고 글자는 sr-only 로 남겨 접근 이름을 지킨다(aria-label 로 바꾸지 않음). */}
      <CheckCheck aria-hidden className="hidden h-5 w-5 max-[360px]:block" />
      <span className="max-[360px]:sr-only">모두 읽음</span>
    </button>
  );
}

/**
 * 모바일 알림 화면 헤더용 '읽은 알림 보관'(WP-1689) — InboxList 제목 행의 버튼과 같은 규칙(읽은 알림 없음·처리 중이면 비활성)·testid.
 * 누르면 확인 없이 보관하고 「보관했습니다 · 되돌리기」 토스트(훅이 띄운다). 목록과 같은 쿼리 키로 캐시를 공유한다.
 */
export function ArchiveReadButton() {
  const { data } = useNotifications(true);
  const items = flattenNotificationPages(data?.pages);
  const archiveRead = useArchiveReadNotifications();
  return (
    <button
      type="button"
      data-testid="inbox-archive-read"
      onClick={() => archiveRead.mutate()}
      disabled={!hasReadNotification(items) || archiveRead.isPending}
      title="읽은 알림 보관"
      className={narrowHeaderActionClass}
    >
      {/* WP-1731: 위 '모두 읽음' 과 같은 규칙 — 좁은 폭에서만 아이콘. */}
      <Archive aria-hidden className="hidden h-5 w-5 max-[360px]:block" />
      <span className="max-[360px]:sr-only">읽은 알림 보관</span>
    </button>
  );
}
