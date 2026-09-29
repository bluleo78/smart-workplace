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
    String actor = e.actorId() == null ? "" : repo.findUserName(e.actorId()).orElse("");
    PushCategory category = PushCategory.of(e.type());
    if (category == PushCategory.ISSUE) {
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
                      "/projects/" + i.projectKey() + "/issues/" + i.number(),
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
    };
  }
}
