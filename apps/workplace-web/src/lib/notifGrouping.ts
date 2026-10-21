// 홈 알림 위젯 "캐치업" 로직 — 최근 알림을 객체별로 묶고 '내 차례/업데이트'로 분류한다.
// 전부 순수 함수(클라이언트 파생) — 백엔드 변경 없음. (내 작업 위젯 myTasks.ts 선례)
import {
  isCalendarType,
  isIssueChatType,
  isWikiShareType,
  notifTarget,
} from "@/components/home/notifTarget";
import type { NotificationResponse } from "@/types/notification";

// 알림 섹션 — 행동 필요(mine) vs 참고(updates).
export type NotifSection = "mine" | "updates";

// 객체 단위로 묶인 알림 그룹 — 위젯 한 행이 이 그룹 하나에 대응한다.
export interface NotifGroup {
  key: string; // 'issue:WP-7' | 'event:5' | 'id:1'
  section: NotifSection;
  repType: NotificationResponse["type"]; // 대표(최신) 알림 종류 — 아이콘 선택용
  title: string; // 표시용 'WP-7 · 리뷰 요청 이슈'
  label: string; // 딥링크/aria 라벨 '리뷰 요청 이슈'
  target: string; // notifTarget 딥링크
  deltaSummary: string; // '코멘트 2건 · 상태 변경'
  actorName: string | null; // 대표 행위자명(REMINDER/시스템이면 null)
  hasAgent: boolean; // 그룹에 AI(AGENT) 행위자 포함 여부
  latestAt: string; // 그룹 내 최신 createdAt
  read: boolean; // 그룹 내 모든 알림 읽음 여부
  unreadIds: number[]; // 미읽음 알림 id (제자리 확인 대상)
  count: number; // 그룹 내 알림 수
}

export interface GroupedNotifs {
  mine: NotifGroup[];
  updates: NotifGroup[];
}

// 알림 단건 섹션 분류. ASSIGNED(나에게 직접 배정)·이슈 챗 AI 질문·이슈 챗 멘션(WP-452) = 행동 필요.
// COMMENTED 는 담당자∪워처 공통 수신이라 "나를 멘션"인지 구분 불가 → 보수적으로 updates.
export function notifSection(n: NotificationResponse): NotifSection {
  // 코멘트 멘션(WP-650)은 나를 직접 가리킨 알림, 노트 접근 요청(WP-579)은 승인·거절이 필요한 알림이라 둘 다 행동 필요.
  return n.type === "ASSIGNED" ||
    n.type === "ISSUE_COMMENT_MENTION" ||
    n.type === "WIKI_SHARE_ACCESS_REQUESTED" ||
    isIssueChatType(n)
    ? "mine"
    : "updates";
}

// 그룹 키 — 같은 대상 객체를 한 줄로 묶는다.
// 캘린더 알림(REMINDER/CALENDAR_INVITED/CALENDAR_RSVP_CHANGED)은 issueId 대신 eventId 로 묶는다(#489).
function groupKey(n: NotificationResponse): string {
  // 노트 공유 알림(WP-579)은 같은 노트라도 유형별로 따로 둔다 — 접근 요청(행동 필요·공유 창을 여는 딥링크)이 공유받음과 한 줄로 섞이지 않게.
  if (isWikiShareType(n))
    return n.wikiPageId != null
      ? `wiki:${n.wikiPageId}:${n.type}`
      : `id:${n.id}`;
  if (isCalendarType(n))
    return n.eventId != null ? `event:${n.eventId}` : `id:${n.id}`;
  if (n.projectKey && n.issueNumber != null)
    return `issue:${n.projectKey}-${n.issueNumber}`;
  return `id:${n.id}`;
}

// 표시 제목 — 캘린더 알림은 일정 제목, 이슈는 'KEY-번호 · 제목'.
function repTitle(n: NotificationResponse): string {
  if (isWikiShareType(n)) return n.wikiPageTitle ?? "노트";
  if (isCalendarType(n)) return n.eventTitle ?? "일정 알림";
  return `${n.projectKey}-${n.issueNumber} · ${n.issueTitle}`;
}

// 딥링크/aria 라벨 — 제목만(기존 위젯 호환).
function repLabel(n: NotificationResponse): string {
  if (isWikiShareType(n)) return n.wikiPageTitle ?? "노트";
  return isCalendarType(n) ? (n.eventTitle ?? "일정 알림") : n.issueTitle;
}

// 델타 요약 문자열 — 종류별 건수를 고정 순서로 합친다.
const TYPE_ORDER: NotificationResponse["type"][] = [
  "AI_QUESTION",
  "ISSUE_CHAT_MENTION",
  "ISSUE_COMMENT_MENTION",
  "ASSIGNED",
  "COMMENTED",
  "STATUS_CHANGED",
  "PRIORITY_CHANGED",
  "REMINDER",
  "CALENDAR_INVITED",
  "CALENDAR_RSVP_CHANGED",
  "CALENDAR_EVENT_UPDATED",
  "CALENDAR_EVENT_CANCELED",
  "WIKI_SHARE_ACCESS_REQUESTED",
  "WIKI_SHARED",
  "WIKI_SHARE_ACCESS_APPROVED",
];
function deltaSummary(group: NotificationResponse[]): string {
  const counts = new Map<NotificationResponse["type"], number>();
  for (const n of group) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  const parts: string[] = [];
  for (const t of TYPE_ORDER) {
    const c = counts.get(t);
    if (!c) continue;
    if (t === "AI_QUESTION") parts.push(c > 1 ? `AI 질문 ${c}건` : "AI 질문");
    else if (t === "ISSUE_CHAT_MENTION")
      parts.push(c > 1 ? `멘션 ${c}건` : "멘션");
    else if (t === "ISSUE_COMMENT_MENTION")
      parts.push(c > 1 ? `코멘트 멘션 ${c}건` : "코멘트 멘션");
    else if (t === "ASSIGNED") parts.push(c > 1 ? `배정 ${c}건` : "배정");
    else if (t === "COMMENTED") parts.push(`코멘트 ${c}건`);
    else if (t === "STATUS_CHANGED")
      parts.push(c > 1 ? `상태 변경 ${c}건` : "상태 변경");
    else if (t === "PRIORITY_CHANGED")
      parts.push(c > 1 ? `우선순위 변경 ${c}건` : "우선순위 변경");
    else if (t === "CALENDAR_INVITED") parts.push("일정 초대");
    else if (t === "CALENDAR_RSVP_CHANGED") parts.push("참석 응답 변경");
    else if (t === "CALENDAR_EVENT_UPDATED") parts.push("일정 변경");
    else if (t === "CALENDAR_EVENT_CANCELED") parts.push("일정 취소");
    else if (t === "REMINDER") parts.push("일정 알림");
    else if (t === "WIKI_SHARE_ACCESS_REQUESTED")
      parts.push(c > 1 ? `접근 요청 ${c}건` : "접근 요청");
    else if (t === "WIKI_SHARED") parts.push("노트 공유");
    else if (t === "WIKI_SHARE_ACCESS_APPROVED") parts.push("접근 승인");
  }
  return parts.join(" · ");
}

// 최근 알림 목록을 객체별로 묶고 섹션별로 최신순 정렬해 반환한다.
export function groupNotifications(
  list: NotificationResponse[],
): GroupedNotifs {
  const buckets = new Map<string, NotificationResponse[]>();
  for (const n of list) {
    const k = groupKey(n);
    const arr = buckets.get(k);
    if (arr) arr.push(n);
    else buckets.set(k, [n]);
  }

  const groups: NotifGroup[] = [];
  for (const [key, arr] of buckets) {
    // 최신순 정렬 후 대표(최신) 알림 결정.
    const sorted = [...arr].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const rep = sorted[0];
    // 그룹에 행동 필요 알림(배정·이슈 챗 질문/멘션)이 하나라도 있으면 '내 차례'.
    const section: NotifSection = arr.some((n) => notifSection(n) === "mine")
      ? "mine"
      : "updates";
    groups.push({
      key,
      section,
      repType: rep.type,
      title: repTitle(rep),
      label: repLabel(rep),
      target: notifTarget(rep),
      deltaSummary: deltaSummary(arr),
      actorName: rep.actorName,
      hasAgent: arr.some((n) => n.actorKind === "AGENT"),
      latestAt: rep.createdAt,
      read: arr.every((n) => n.read),
      unreadIds: arr.filter((n) => !n.read).map((n) => n.id),
      count: arr.length,
    });
  }

  groups.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  return {
    mine: groups.filter((g) => g.section === "mine"),
    updates: groups.filter((g) => g.section === "updates"),
  };
}
