package com.workplace.notify.push;

import com.workplace.global.util.KoreanParticles;
import com.workplace.global.util.Texts;
import com.workplace.issue.outbound.AgentWorkNoticeEvent;
import com.workplace.notify.dto.NotificationType;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 인박스 알림 → PushMessage 조립. 문구는 프론트 InboxPanel 의 ACTION_LABEL 과 같은 표현을 쓴다(인박스와 푸시 문구 일치). 대상 이슈/일정이
 * 커밋 직후 삭제됐으면 null — 푸시하지 않는다. pushExecutor 스레드(TenantContext 복원됨)에서 새 트랜잭션으로 조회해 RLS GUC 가 주입된다.
 */
@Service
@RequiredArgsConstructor
public class PushContentService {

  static final int INBOX_TTL = 259200;
  private final PushContentRepository repo;

  /** 인박스 이벤트 → PushMessage. 대상(이슈/일정)이 없거나 삭제됐으면 null. */
  @Transactional(readOnly = true)
  public PushMessage forInbox(InboxPushRequestedEvent e) {
    // 행위자 없음/탈퇴 등으로 이름 조회 실패 시 "시스템" — 프론트 InboxPanel 의 `n.actorName ?? '시스템'` 과 표기 통일.
    String actor = e.actorId() == null ? "시스템" : repo.findUserName(e.actorId()).orElse("시스템");
    // 카테고리는 이벤트가 정한 값(수신자 묶음별 — AI_QUESTION 의 멘션 수신자는 MENTION). 이슈/일정 분기는 카테고리가 아니라 유형으로
    // 가른다 — MENTION 카테고리의 이슈 챗 알림이 일정 분기로 빠져 푸시가 사라지지 않게(WP-452).
    PushCategory category = e.category();
    if (isWikiShare(e.type())) return forWikiShare(e, category, actor);
    // 개인 비서 연결 회수(WP-1170) — 가리킬 이슈·일정이 없다. 다시 연결할 내 비서 설정으로 보낸다(프론트 notifTarget 과 같은 경로).
    if (e.type() == NotificationType.PERSONAL_ASSISTANT_REVOKED) {
      return new PushMessage(
          e.tenantId(),
          category,
          "개인 비서 연결 해제",
          e.actorId() == null ? "내 개인 비서의 AI 연결이 해제됐어요 — 다시 연결해 주세요" : actor + label(e.type()),
          "/settings/assistant",
          "personal-assistant-revoked",
          "normal",
          INBOX_TTL);
    }
    if (PushCategory.of(e.type()) != PushCategory.CALENDAR) {
      if (e.issueId() == null) return null;
      return repo.findIssue(e.issueId())
          .map(
              i ->
                  new PushMessage(
                      e.tenantId(),
                      category,
                      Texts.truncateCodePoints(
                          i.projectKey() + "-" + i.number() + " " + i.title(), 120),
                      actor + issueLabel(e),
                      issueUrl(i.projectKey(), i.number(), e.type()),
                      "issue-" + e.issueId(),
                      "normal",
                      INBOX_TTL))
          .orElse(null);
    }
    if (e.eventId() == null) {
      // 취소 알림(WP-712) — 일정 행이 없어 알림에 담긴 제목으로 보낸다. 지운 일정으로 가는 링크 대신 캘린더를 연다.
      if (e.eventTitle() == null) return null;
      return new PushMessage(
          e.tenantId(),
          category,
          Texts.truncateCodePoints(e.eventTitle(), 120),
          actor + label(e.type()),
          "/calendar",
          "event-canceled-" + e.eventTitle().hashCode(),
          "normal",
          INBOX_TTL);
    }
    return repo.findEventTitle(e.eventId())
        .map(
            title -> {
              boolean reminder = e.type() == NotificationType.REMINDER;
              return new PushMessage(
                  e.tenantId(),
                  category,
                  reminder ? "일정 알림" : Texts.truncateCodePoints(title, 120),
                  reminder ? Texts.truncateCodePoints(title, 120) : actor + label(e.type()),
                  "/calendar?eventId=" + e.eventId(),
                  "event-" + e.eventId(),
                  "normal",
                  INBOX_TTL);
            })
        .orElse(null);
  }

  /**
   * 노트 공유 알림(WP-579) 푸시 — 제목은 노트 제목, 이동 경로는 알림 열기 경로({@link #wikiUrl}). 노트가 지워졌으면 null. 메시지 본문은 푸시에
   * 싣지 않는다(잠금 화면 노출 최소화).
   */
  private PushMessage forWikiShare(InboxPushRequestedEvent e, PushCategory category, String actor) {
    if (e.wikiPageId() == null) return null;
    return repo.findWikiPageTitle(e.wikiPageId())
        .map(
            title ->
                new PushMessage(
                    e.tenantId(),
                    category,
                    Texts.truncateCodePoints(title, 120),
                    e.type() == NotificationType.WIKI_SHARE_ACCESS_APPROVED
                        ? label(e.type())
                        : actor + label(e.type()),
                    wikiUrl(e.wikiPageId(), e.type()),
                    "wiki-" + e.wikiPageId(),
                    "normal",
                    INBOX_TTL))
        .orElse(null);
  }

  /**
   * 노트 공유 알림 이동 경로 — 웹 `/wiki/open/{pageId}` 가 멤버면 노트로, 공유 대상이면 공유 화면으로 보낸다. 접근 요청은 공유 창을 연 채로
   * (`?share=1`, 프론트 notifTarget 과 같은 규칙).
   */
  static String wikiUrl(long pageId, NotificationType type) {
    String base = "/wiki/open/" + pageId;
    return type == NotificationType.WIKI_SHARE_ACCESS_REQUESTED ? base + "?share=1" : base;
  }

  /** 노트 공유에서 생긴 알림인지(WP-579). */
  private static boolean isWikiShare(NotificationType t) {
    return t == NotificationType.WIKI_SHARED
        || t == NotificationType.WIKI_SHARE_ACCESS_REQUESTED
        || t == NotificationType.WIKI_SHARE_ACCESS_APPROVED;
  }

  /**
   * 이슈 알림 이동 경로. 이슈 챗 알림(AI_QUESTION·ISSUE_CHAT_MENTION)은 이슈 챗 드로워를 연 채로 연다(`?chat=1` — 웹
   * useIssueChatDrawerParam 과 같은 딥링크, 프론트 notifTarget 과 같은 규칙).
   */
  static String issueUrl(String projectKey, int number, NotificationType type) {
    String base = "/projects/" + projectKey + "/issues/" + number;
    return isIssueChat(type) ? base + "?chat=1" : base;
  }

  /** 이슈 챗에서 생긴 알림인지(WP-452). */
  private static boolean isIssueChat(NotificationType t) {
    return t == NotificationType.AI_QUESTION || t == NotificationType.ISSUE_CHAT_MENTION;
  }

  /**
   * 이슈 알림 행위 문구. 상태 변경에 새 상태 이름이 있으면(WP-869) 「님이 상태를 '검토 중'으로 변경했습니다」 — 인박스와 같은 문구로, 조사도 인박스처럼 받침에
   * 맞춘다({@link KoreanParticles#direction} — 한글로 끝나지 않는 이름만 「(으)로」). AI 작업 상태로 생긴 알림(WP-913)은 원인 상태별
   * 문구 — 웹 notifText 의 notificationAction 과 같은 문구라 인박스와 푸시가 같은 말을 한다. 그 외(이름·상태가 없는 예전 알림, 이슈 챗
   * 질문으로 생긴 AI_QUESTION 등)는 {@link #label} 그대로.
   */
  private static String issueLabel(InboxPushRequestedEvent e) {
    if (e.type() == NotificationType.STATUS_CHANGED && e.statusName() != null)
      return "님이 상태를 '"
          + e.statusName()
          + "'"
          + KoreanParticles.direction(e.statusName())
          + " 변경했습니다";
    // Set.of().contains(null) 은 NPE 라 상태 없음을 먼저 거른다.
    if (e.agentWorkState() != null
        && STATE_LABEL_ALLOWED.getOrDefault(e.type(), Set.of()).contains(e.agentWorkState()))
      return AGENT_WORK_STATE_LABEL.get(e.agentWorkState());
    return label(e.type());
  }

  /**
   * 종류별로 상태 문구를 쓰는 상태(WP-913) — 표에 없는 종류·상태 조합(검토 요청 전부, 실패의 FAILED·모르는 상태 등)은 종류 문구 그대로다. 엇갈린
   * 조합(실패 알림에 BLOCKED 가 실린 경우 등)이 다른 종류의 문구를 빌려 쓰지 않게 막는다.
   */
  private static final Map<NotificationType, Set<String>> STATE_LABEL_ALLOWED =
      Map.of(
          NotificationType.AI_WORK_FAILED,
          Set.of(AgentWorkNoticeEvent.REJECTED),
          NotificationType.AI_QUESTION,
          Set.of(
              AgentWorkNoticeEvent.INPUT_REQUIRED,
              AgentWorkNoticeEvent.AUTH_REQUIRED,
              AgentWorkNoticeEvent.BLOCKED));

  /**
   * AI 작업 상태 → 문구(WP-913). 종류 기본 문구({@link #label})와 다른 상태만 둔다 — 검토 대기(REVIEW)·실패(FAILED)·모르는 상태는
   * 종류 문구로 떨어진다. 웹 notifText 의 AGENT_WORK_STATE_LABEL 과 같은 표다.
   */
  private static final Map<String, String> AGENT_WORK_STATE_LABEL =
      Map.of(
          AgentWorkNoticeEvent.REJECTED, "님이 작업을 거절했습니다",
          AgentWorkNoticeEvent.INPUT_REQUIRED, "님이 답변을 기다리고 있습니다",
          AgentWorkNoticeEvent.AUTH_REQUIRED, "님이 권한이 필요하다고 알렸습니다",
          AgentWorkNoticeEvent.BLOCKED, "님이 작업이 막혔다고 알렸습니다");

  /** 행위 문구(행위자 이름 뒤에 붙음). */
  private static String label(NotificationType t) {
    return switch (t) {
      case ASSIGNED -> "님이 회원님을 배정했습니다";
      case REPORTER_ASSIGNED -> "님이 회원님을 보고자로 지정했습니다";
      case COMMENTED -> "님이 코멘트를 남겼습니다";
      case STATUS_CHANGED -> "님이 상태를 변경했습니다";
      case PRIORITY_CHANGED -> "님이 우선순위를 변경했습니다";
      case CALENDAR_INVITED -> "님이 일정에 초대했습니다";
      case CALENDAR_RSVP_CHANGED -> "님이 참석 응답을 변경했습니다";
      case REMINDER -> "일정 알림";
      case AI_QUESTION -> "님이 이슈 챗에서 질문했습니다";
      case ISSUE_CHAT_MENTION -> "님이 이슈 챗에서 회원님을 멘션했습니다";
      case ISSUE_COMMENT_MENTION -> "님이 코멘트에서 회원님을 멘션했습니다";
      case WIKI_SHARED -> "님이 노트를 공유했습니다";
      case WIKI_SHARE_ACCESS_REQUESTED -> "님이 접근을 요청했습니다";
      case WIKI_SHARE_ACCESS_APPROVED -> "접근이 승인됐습니다";
      case CALENDAR_EVENT_UPDATED -> "님이 일정을 변경했습니다";
      case CALENDAR_EVENT_CANCELED -> "님이 일정을 취소했습니다";
      // AI 작업 상태 알림(WP-913) — 실패의 기본 문구는 FAILED, 거절(REJECTED)은 issueLabel 이 따로 고른다.
      case AI_REVIEW_REQUESTED -> "님이 검토를 요청했습니다";
      case AI_WORK_FAILED -> "님이 작업에 실패했습니다";
      case PERSONAL_ASSISTANT_REVOKED -> "님이 내 개인 비서의 AI 연결을 해제했어요 — 다시 연결해 주세요";
    };
  }
}
