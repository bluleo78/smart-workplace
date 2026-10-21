// src/components/layout/InboxList.tsx
// 인박스 목록 — 데스크톱 Popover(InboxPanel)와 모바일 /notifications 화면이 공유한다(WP-126).
// 헤더(모두 읽음) + 푸시 유도 배너 + 무한스크롤 목록. 기존 testid 를 그대로 유지한다.
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  isCalendarType,
  isWikiShareType,
  notifTarget,
} from "@/components/home/notifTarget";
import { PushPromptBanner } from "@/components/layout/PushPromptBanner";
import { MobileEmptyState } from "@/components/mobile/MobileEmptyState";
import { useMarkAllNotificationsRead } from "@/hooks/queries/useMarkAllNotificationsRead";
import { useMarkNotificationRead } from "@/hooks/queries/useMarkNotificationRead";
import {
  flattenNotificationPages,
  useNotifications,
} from "@/hooks/queries/useNotifications";
import { useUnreadCount } from "@/hooks/queries/useUnreadCount";
import { hasAiToken } from "@/lib/aiToken";
import { formatDateTimeMinute, formatRelativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { NotificationResponse } from "@/types/notification";

// 스크롤이 바닥에서 이 거리(px) 이내로 들어오면 다음 페이지를 로드한다.
const LOAD_MORE_THRESHOLD_PX = 48;

// 알림 종류별 동작 문구(액터명 뒤에 붙는다).
const ACTION_LABEL: Record<NotificationResponse["type"], string> = {
  ASSIGNED: "님이 회원님을 배정했습니다",
  COMMENTED: "님이 코멘트를 남겼습니다",
  STATUS_CHANGED: "님이 상태를 변경했습니다",
  PRIORITY_CHANGED: "님이 우선순위를 변경했습니다",
  // REMINDER/CALENDAR_INVITED/CALENDAR_RSVP_CHANGED 는 별도 분기로 렌더(아래 isCalendarType 목록 참조).
  REMINDER: "일정 알림",
  CALENDAR_INVITED: "님이 일정에 초대했습니다",
  CALENDAR_RSVP_CHANGED: "님이 참석 응답을 변경했습니다",
  // WP-452 이슈 챗 알림 — 클릭하면 이슈 챗 드로워가 열린 이슈 상세로 간다(notifTarget).
  AI_QUESTION: "님이 이슈 챗에서 질문했습니다",
  ISSUE_CHAT_MENTION: "님이 이슈 챗에서 회원님을 멘션했습니다",
  // WP-650 코멘트 멘션 — 클릭하면 그 이슈 상세로 간다(챗 드로워 없이).
  ISSUE_COMMENT_MENTION: "님이 코멘트에서 회원님을 멘션했습니다",
  // WP-579 노트 공유 알림 — 노트 제목이 들어간 실제 문구는 wikiShareText 가 만든다(이 값은 타입 완결용 기본 문구).
  WIKI_SHARED: "님이 노트를 공유했습니다",
  WIKI_SHARE_ACCESS_REQUESTED: "님이 접근을 요청했습니다",
  WIKI_SHARE_ACCESS_APPROVED: "접근이 승인됐습니다",
};

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
 * 인박스 목록 본체.
 * @param enabled 조회 활성 여부(Popover 는 열렸을 때만 조회)
 * @param onNavigate 행 클릭 후 이동 직전에 호출(Popover 닫기 등). 닫을 것이 없는 화면(모바일 /notifications)은 생략
 * @param scrollClassName 스크롤 영역 클래스(모바일 페이지는 'min-h-0 flex-1 overflow-y-auto')
 * @param hideHeader 자체 제목 행('알림' + 모두 읽음) 숨김 — 모바일 /notifications 는 화면 헤더가 제목을 갖고
 *   '모두 읽음' 은 헤더 액션 자리(MarkAllReadButton)로 옮겨 별도 한 줄을 쓰지 않는다(U1-7).
 * @param screenEmpty 빈 상태를 전체 화면 규격으로(모바일 /notifications, U3-R11)
 */
export function InboxList({
  enabled,
  onNavigate,
  scrollClassName = "max-h-96 overflow-y-auto",
  hideHeader = false,
  screenEmpty = false,
}: {
  enabled: boolean;
  onNavigate?: () => void;
  scrollClassName?: string;
  hideHeader?: boolean;
  /** 빈 상태를 전체 화면 규격(MobileEmptyState)으로 — 모바일 /notifications 전용. 데스크톱 Popover 는 기존 작은 빈 상태. */
  screenEmpty?: boolean;
}) {
  const navigate = useNavigate();
  const { data: unread = 0 } = useUnreadCount();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotifications(enabled);
  const items = flattenNotificationPages(data?.pages);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  // 스크롤 영역이 바닥 근처에 도달하면 다음 페이지 로드(#610 무한스크롤).
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (
      distanceToBottom < LOAD_MORE_THRESHOLD_PX &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage();
    }
  };

  // 행 클릭: 안읽음이면 읽음 처리 → onNavigate(패널 닫기 등) → 대상으로 이동.
  // 딥링크 규칙은 notifTarget() 공용 유틸과 동일(캘린더 알림→캘린더, 식별정보 없으면 인박스 대용 폴백).
  const onRowClick = (n: NotificationResponse) => {
    if (!n.read) markRead.mutate(n.id);
    onNavigate?.();
    navigate(notifTarget(n));
  };

  return (
    <>
      {!hideHeader && (
        <div className="flex items-center border-b px-3 py-2 justify-between">
          <span className="text-sm font-semibold">알림</span>
          <button
            type="button"
            data-testid="inbox-mark-all"
            onClick={() => markAll.mutate()}
            // 알림 없거나 모두 읽음 상태이거나 처리 중이면 비활성화
            disabled={items.length === 0 || unread === 0 || markAll.isPending}
            className="text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            모두 읽음
          </button>
        </div>
      )}
      <PushPromptBanner />
      <div
        onScroll={onScroll}
        data-testid="inbox-scroll-area"
        className={scrollClassName}
      >
        {isLoading ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            불러오는 중…
          </p>
        ) : items.length === 0 && screenEmpty ? (
          // 모바일 전체 화면: 메일 계정 없음과 같은 공용 빈 상태 규격(U3-R11).
          <MobileEmptyState
            data-testid="inbox-empty"
            className="h-full"
            icon={Bell}
            title="새 알림이 없습니다"
            description="이슈 배정, 코멘트, 상태 변경 알림이 여기에 표시됩니다."
          />
        ) : items.length === 0 ? (
          // 빈 상태: 아이콘 + 제목 + 설명 (디자인 시스템 §2.5 Empty State 4요소)
          <div
            data-testid="inbox-empty"
            className="flex flex-col items-center gap-2 px-3 py-8 text-center text-muted-foreground"
          >
            <Bell className="h-8 w-8 opacity-30" />
            <p className="text-sm font-medium">새 알림이 없습니다</p>
            <p className="text-xs">
              이슈 배정, 코멘트, 상태 변경 알림이 여기에 표시됩니다.
            </p>
          </div>
        ) : (
          <ul>
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  data-testid="inbox-item"
                  onClick={() => onRowClick(n)}
                  className={cn(
                    "flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm hover:bg-accent/50",
                    !n.read && "bg-accent/20",
                  )}
                >
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
                            {n.actorKind === "AGENT" &&
                              !hasAiToken(n.actorName) && (
                                <span className="ml-1 rounded bg-primary/10 px-1 text-xs text-primary">
                                  AI
                                </span>
                              )}
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
                        {n.actorKind === "AGENT" &&
                          !hasAiToken(n.actorName) && (
                            <span className="ml-1 rounded bg-primary/10 px-1 text-xs text-primary">
                              AI
                            </span>
                          )}
                        <span className="text-muted-foreground">
                          {ACTION_LABEL[n.type]}
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
                        {n.actorKind === "AGENT" &&
                          !hasAiToken(n.actorName) && (
                            <span className="ml-1 rounded bg-primary/10 px-1 text-xs text-primary">
                              AI
                            </span>
                          )}
                        <span className="text-muted-foreground">
                          {ACTION_LABEL[n.type]}
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
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              </li>
            ))}
            {isFetchingNextPage && (
              <li
                data-testid="inbox-loading-more"
                className="px-3 py-2 text-center text-xs text-muted-foreground"
              >
                더 불러오는 중…
              </li>
            )}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * 모바일 알림 화면 헤더용 '모두 읽음' — InboxList 제목 행의 버튼과 같은 규칙(알림 없음·모두 읽음·처리 중이면 비활성)·testid.
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
      onClick={() => markAll.mutate()}
      disabled={items.length === 0 || unread === 0 || markAll.isPending}
      className="flex h-11 shrink-0 items-center px-3 text-sm text-primary disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60"
    >
      모두 읽음
    </button>
  );
}
