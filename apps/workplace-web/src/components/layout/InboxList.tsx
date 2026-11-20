// src/components/layout/InboxList.tsx
// 인박스 목록 — 데스크톱 Popover(InboxPanel)와 모바일 /notifications 화면이 공유한다(WP-126).
// 헤더(모두 읽음·읽은 알림 보관) + 푸시 유도 배너 + 무한스크롤 목록. 기존 testid 를 그대로 유지한다.
import { Archive, Bell, CheckCheck } from "lucide-react";
import { useEffect, useRef } from "react";
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
import { PushPromptBanner } from "@/components/layout/PushPromptBanner";
import { LoadErrorState } from "@/components/LoadErrorState";
import { narrowHeaderActionClass } from "@/components/mobile/headerClass";
import { MobileEmptyState } from "@/components/mobile/MobileEmptyState";
import { Button } from "@/components/ui/button";
import { AgentActorBadge } from "@/components/users/AgentBadge";
import { useArchiveReadNotifications } from "@/hooks/queries/useArchiveReadNotifications";
import { useMarkAllNotificationsRead } from "@/hooks/queries/useMarkAllNotificationsRead";
import { useMarkNotificationRead } from "@/hooks/queries/useMarkNotificationRead";
import {
  flattenNotificationPages,
  useArchivedNotifications,
  useNotifications,
} from "@/hooks/queries/useNotifications";
import { useUnarchiveNotification } from "@/hooks/queries/useUnarchiveNotification";
import { useUnreadCount } from "@/hooks/queries/useUnreadCount";
import { formatDateTimeMinute, formatRelativeTime } from "@/lib/formatters";
import {
  notificationAction,
  PERSONAL_ASSISTANT_REVOKED_NO_ACTOR,
} from "@/lib/notifText";
import { showsLoadError } from "@/lib/queryFailure";
import { cn } from "@/lib/utils";
import type { NotificationResponse } from "@/types/notification";

// 스크롤이 바닥에서 이 거리(px) 이내로 들어오면 다음 페이지를 로드한다.
const LOAD_MORE_THRESHOLD_PX = 48;

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

/**
 * 「알림 | 보관함」 전환 탭(WP-1690) — 데스크톱 제목 줄과 모바일 /notifications 가 함께 쓴다.
 * 선택 탭은 굵게·밑줄로 구분하고 aria-selected 로 알린다.
 */
export function InboxViewTabs({
  view,
  onChange,
}: {
  view: InboxView;
  onChange: (v: InboxView) => void;
}) {
  const tabs: { id: InboxView; label: string }[] = [
    { id: "inbox", label: "알림" },
    { id: "archive", label: "보관함" },
  ];
  return (
    <div
      role="tablist"
      aria-label="알림 보기"
      className="flex items-center gap-3"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          // id: 보관함 빈 상태 CTA 로 받은 알림에 돌아올 때 포커스를 받을 자리(WP-1848)
          id={`inbox-tab-${t.id}`}
          aria-selected={view === t.id}
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
  // 보관함 CTA 로 받은 알림에 돌아왔는지 — 눌린 버튼(빈 상태)이 사라져 포커스가 body 로 떨어지므로,
  // 전환이 그려진 뒤(effect) 받은 탭 버튼으로 옮긴다. 탭은 모바일에서 InboxList 밖(헤더)에 있어 ref 대신 id 로 찾는다.
  const focusInboxTabAfterSwitch = useRef(false);
  useEffect(() => {
    if (view !== "inbox" || !focusInboxTabAfterSwitch.current) return;
    focusInboxTabAfterSwitch.current = false;
    document.getElementById("inbox-tab-inbox")?.focus();
  }, [view]);
  const onEmptyAction = () => {
    if (isArchive) {
      focusInboxTabAfterSwitch.current = true;
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
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    query;
  const items = flattenNotificationPages(data?.pages);
  const unarchive = useUnarchiveNotification();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const archiveRead = useArchiveReadNotifications();

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

  // 행 클릭: (보관함이 아니고) 안읽음이면 읽음 처리 → onNavigate(패널 닫기 등) → 대상으로 이동.
  // 딥링크 규칙은 notifTarget() 공용 유틸과 동일(캘린더 알림→캘린더, 식별정보 없으면 인박스 대용 폴백).
  const onRowClick = (n: NotificationResponse) => {
    if (!isArchive && !n.read) markRead.mutate(n.id);
    goTo(notifTarget(n));
  };

  // 빈 상태 CTA 버튼 — 전체 화면(터치 규격)·팝오버(작은 윤곽선)가 크기·모양만 달리 같은 요소를 쓴다.
  const emptyActionButton = (
    <Button
      size={screenEmpty ? "default" : "sm"}
      variant={screenEmpty ? "default" : "outline"}
      className={screenEmpty ? "h-11 px-5" : undefined}
      data-testid="inbox-empty-action"
      onClick={onEmptyAction}
    >
      {emptyActionLabel}
    </Button>
  );

  return (
    <>
      {!hideHeader && (
        <div className="flex items-center border-b px-3 py-2 justify-between">
          {/* 제목 자리는 「알림 | 보관함」 전환(WP-1690) — 선택 탭이 제목 역할을 한다. */}
          <InboxViewTabs view={view} onChange={onViewChange} />
          {/* 오른쪽 묶음: 모두 읽음 · 읽은 알림 보관(WP-1689). 보관함에서는 대상이 없어 숨긴다. 줄마다 보관 단추는 두지 않는다. */}
          {!isArchive && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="inbox-mark-all"
                onClick={() => markAll.mutate()}
                // 알림 없거나 모두 읽음 상태이거나 처리 중이면 비활성화
                disabled={
                  items.length === 0 || unread === 0 || markAll.isPending
                }
                className="text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
      <div
        onScroll={onScroll}
        data-testid="inbox-scroll-area"
        className={scrollClassName}
      >
        {showsLoadError(query) && items.length === 0 ? (
          // 조회 실패 — 빈 상태로 보이면 「알림 설정」 문제로 오해하므로 공용 실패 안내(다시 시도)를 보인다(WP-1848).
          // 불러오는 중보다 먼저 본다 — 다시 부르는 동안에도 안내를 두어야 초점이 body 로 사라지지 않는다(lib/queryFailure).
          // 일부 페이지를 이미 받아 items 가 있으면 여기로 오지 않고 목록을 유지한다.
          <LoadErrorState
            variant="inline"
            title="알림을 불러오지 못했습니다"
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
          <ul>
            {items.map((n) => (
              <li key={n.id} className={cn(isArchive && "flex items-stretch")}>
                <button
                  type="button"
                  data-testid="inbox-item"
                  onClick={() => onRowClick(n)}
                  className={cn(
                    "flex w-full min-w-0 items-start gap-2 row-divider px-3 py-2 text-left text-sm hover:bg-accent/50",
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
                          내가 연결하지 않았다면 설정 › API 토큰에서 끊어 주세요
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
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
                {isArchive && (
                  // 보관함 줄 단추 — 줄 버튼 안에 넣을 수 없어 형제로 둔다(버튼 안 버튼 금지). 이동 없이 그 id 만 되돌린다.
                  <button
                    type="button"
                    data-testid="inbox-unarchive"
                    onClick={(e) => {
                      e.stopPropagation();
                      unarchive.mutate(n.id);
                    }}
                    // 처리 중인 그 줄만 막는다 — 전체를 막으면 한 줄 되돌리는 동안 다른 줄 클릭이 소리 없이 무시된다.
                    disabled={unarchive.isPending && unarchive.variables === n.id}
                    className="shrink-0 row-divider px-3 text-xs text-primary hover:bg-accent/50 disabled:opacity-50"
                  >
                    되돌리기
                  </button>
                )}
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
      title="모두 읽음"
      className={narrowHeaderActionClass}
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
