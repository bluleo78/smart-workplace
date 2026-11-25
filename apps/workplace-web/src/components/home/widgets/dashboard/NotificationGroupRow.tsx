import {
  AtSign,
  Bell,
  Bot,
  Calendar,
  CalendarClock,
  CalendarX,
  CircleAlert,
  ClipboardCheck,
  Clock,
  FileText,
  MailX,
  MessageCircleQuestion,
  MessageSquare,
  Plug,
  RefreshCw,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import { useId } from "react";
import { Link } from "react-router-dom";

import { AgentActorBadge } from "@/components/users/AgentBadge";
import { formatRelativeTime } from "@/lib/formatters";
import type { NotifGroup } from "@/lib/notifGrouping";
import type { NotificationResponse } from "@/types/notification";

// 대표 알림 종류별 아이콘.
const TYPE_ICON: Record<NotificationResponse["type"], typeof UserPlus> = {
  ASSIGNED: UserPlus,
  REPORTER_ASSIGNED: UserPlus, // 보고자로 지정됨(WP-944)
  COMMENTED: MessageSquare,
  STATUS_CHANGED: RefreshCw,
  PRIORITY_CHANGED: RefreshCw,
  REMINDER: Calendar,
  CALENDAR_INVITED: Calendar,
  CALENDAR_RSVP_CHANGED: Calendar,
  AI_QUESTION: MessageCircleQuestion, // 이슈 챗 AI 질문(WP-452)
  ISSUE_CHAT_MENTION: AtSign, // 이슈 챗 멘션(WP-452)
  ISSUE_COMMENT_MENTION: AtSign, // 코멘트 멘션(WP-650)
  CALENDAR_EVENT_UPDATED: CalendarClock, // 일정 시간·장소 변경(WP-712)
  CALENDAR_EVENT_CANCELED: CalendarX, // 일정 취소(WP-712)
  WIKI_SHARED: FileText, // 노트 공유 알림(WP-579)
  WIKI_SHARE_ACCESS_REQUESTED: FileText,
  WIKI_SHARE_ACCESS_APPROVED: FileText,
  AI_REVIEW_REQUESTED: ClipboardCheck, // AI 작업 검토 요청(WP-913)
  AI_WORK_FAILED: CircleAlert, // AI 작업 실패·거절(WP-913)
  PERSONAL_ASSISTANT_REVOKED: Bot, // 내 개인 비서 AI 연결 해제(WP-1170)
  AI_ASSISTANT_LIMIT_WAIT: Bot, // 비서·AI 계정 사용 한도 대기(WP-2108)
  OAUTH_APP_CONNECTED: Plug, // 새 앱 연결(WP-1686)
  MAIL_SEND_FAILED: MailX, // 메일 보내기 실패(WP-1786)
  WORKFLOW_VISIT_LIMIT: RotateCcw, // 워크플로우 되돌림 한도(WP-1985)
  WORKFLOW_TURN_REMIND: Clock, // 워크플로우 차례가 오래 기다림(WP-1987)
  WORKFLOW_TURN_ESCALATE: Clock, // 워크플로우 단계가 오래 멈춤 — 관리자 확인(WP-1987)
};

// 백엔드가 유니온에 없는 새 타입을 보내더라도(#585 재발 방지) 크래시 대신 폴백 아이콘을 렌더한다.
const FALLBACK_ICON = Bell;

/**
 * 알림 그룹 한 행 — 아이콘 + 객체 제목(primary) + 행위자(AI배지)·델타·시간 메타(secondary) + ✓.
 * 제목을 맨 위에 두고 메타를 한 줄로 합쳐 시각적 위계를 명확히 한다(오늘 일정 위젯과 제목 크기 일치).
 * 행 본문 클릭은 딥링크 이동, ✓ 는 제자리 확인(그룹 내 미읽음 read).
 */
export function NotificationGroupRow({
  group,
  onAck,
}: {
  group: NotifGroup;
  onAck: (ids: number[]) => void;
}) {
  const Icon = TYPE_ICON[group.repType] ?? FALLBACK_ICON;
  // 둘째 줄(행위자·변경 요약·시간)을 링크의 접근 설명으로 잇기 위한 id(WP-1891).
  const descId = useId();
  return (
    <li
      className="group flex items-start gap-2 rounded px-1 py-1.5 hover:bg-muted/50"
      data-testid="dash-notif-row"
    >
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <Link
        to={group.target}
        // 미읽음을 인박스(WP-1844)처럼 「읽지 않음, 」으로 알린다 — aria-label 이 내용을 덮으므로 sr-only 대신 이름에 넣는다(WP-1887).
        aria-label={`${group.read ? "" : "읽지 않음, "}알림 열기: ${group.label}`}
        // 열기 = 읽음 처리(InboxPanel과 동일). 이동과 함께 그룹 미읽음을 read 처리.
        onClick={() => onAck(group.unreadIds)}
        // aria-label 이 링크 내용을 덮어 둘째 줄이 안 읽히므로, 이름은 짧게 두고 둘째 줄을 설명으로 잇는다(WP-1891).
        aria-describedby={descId}
        className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {/* primary: 객체 제목(미읽음이면 medium). */}
        <span
          className={`block truncate text-sm ${group.read ? "text-muted-foreground" : "font-medium"}`}
        >
          {group.title}
        </span>
        {/* secondary: 행위자 + 에이전트 배지 + 델타 + 상대시간 한 줄(muted).
            {" "} 는 접근 설명에서 단어가 붙지 않게 하는 공백 — flex 라 화면에는 그려지지 않는다(WP-1891). */}
        <span
          id={descId}
          className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"
        >
          {group.actorName && (
            <span className="truncate">{group.actorName}</span>
          )}
          {" "}
          {/* 에이전트 배지 — 인박스와 같은 공용 AgentActorBadge(Bot+「에이전트」, WP-935). 그룹에 AGENT 행위자가 있으면 붙는다. */}
          <AgentActorBadge kind={group.hasAgent ? "AGENT" : null} />
          {" "}
          <span className="truncate">
            {group.deltaSummary} · {formatRelativeTime(group.latestAt)}
          </span>
        </span>
      </Link>
      {group.unreadIds.length > 0 && (
        // 제자리 읽음 — 평소 숨김, hover/포커스 시 노출되는 라벨 버튼(맨 체크표시의 affordance 모호함 해소).
        // WP-237: 터치(coarse)에선 숨은 채로 탭이 닿지 않게 pointer-events 를 끈다 — 행 열기(=읽음)·「모두 읽음」이 대체 경로.
        <button
          type="button"
          data-testid="dash-notif-ack"
          aria-label={`읽음 처리: ${group.label}`}
          title="읽음 처리"
          onClick={() => onAck(group.unreadIds)}
          className="mt-0.5 shrink-0 rounded border px-2 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 pointer-coarse:pointer-events-none"
        >
          읽음
        </button>
      )}
    </li>
  );
}
