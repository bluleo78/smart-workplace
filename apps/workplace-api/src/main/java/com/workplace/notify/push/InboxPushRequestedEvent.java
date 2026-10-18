package com.workplace.notify.push;

import com.workplace.notify.dto.NotificationType;
import java.util.List;

/**
 * 인박스 알림이 생성됐음을 알리는 notify 내부 이벤트. NotificationService 가 insert 직후 발행하고, 커밋 후 PushDispatcher 가 푸시로
 * 내보낸다. recipientIds 는 실제 insert 된 수신자(actor 제외·중복 제거 후). issueId/eventId 중 유형에 맞는 하나만 채워진다.
 *
 * <p>category 는 이 수신자 묶음에 적용할 푸시 카테고리(사용자 설정 단위). 대개 {@link PushCategory#of} 그대로지만, 같은 알림 유형이라도
 * 수신자마다 카테고리가 다를 수 있어(AI_QUESTION — 멘션된 사람은 MENTION, 나머지는 ISSUE, WP-452) 이벤트에 명시한다.
 */
public record InboxPushRequestedEvent(
    long tenantId,
    NotificationType type,
    PushCategory category,
    List<Long> recipientIds,
    Long actorId,
    Long issueId,
    Long eventId) {

  /** 카테고리를 유형 기본값({@link PushCategory#of})으로 정하는 생성자 — 수신자별 분기가 없는 대부분의 알림용. */
  public InboxPushRequestedEvent(
      long tenantId,
      NotificationType type,
      List<Long> recipientIds,
      Long actorId,
      Long issueId,
      Long eventId) {
    this(tenantId, type, PushCategory.of(type), recipientIds, actorId, issueId, eventId);
  }
}
