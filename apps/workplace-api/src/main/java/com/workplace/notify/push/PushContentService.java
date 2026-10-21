package com.workplace.notify.push;

import com.workplace.global.util.Texts;
import com.workplace.notify.dto.NotificationType;
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
                      actor + label(e.type()),
                      issueUrl(i.projectKey(), i.number(), e.type()),
                      "issue-" + e.issueId(),
                      "normal",
                      INBOX_TTL))
          .orElse(null);
    }
    if (e.eventId() == null) return null;
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

  /** 행위 문구(행위자 이름 뒤에 붙음). */
  private static String label(NotificationType t) {
    return switch (t) {
      case ASSIGNED -> "님이 회원님을 배정했습니다";
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
    };
  }
}
