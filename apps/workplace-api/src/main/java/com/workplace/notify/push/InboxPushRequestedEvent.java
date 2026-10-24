package com.workplace.notify.push;

import com.workplace.notify.dto.NotificationType;
import java.util.List;

/**
 * 인박스 알림이 생성됐음을 알리는 notify 내부 이벤트. NotificationService 가 insert 직후 발행하고, 커밋 후 PushDispatcher 가 푸시로
 * 내보낸다. recipientIds 는 실제 insert 된 수신자(actor 제외·중복 제거 후). issueId/eventId/wikiPageId 중 유형에 맞는 하나만
 * 채워진다.
 *
 * <p>category 는 이 수신자 묶음에 적용할 푸시 카테고리(사용자 설정 단위). 대개 {@link PushCategory#of} 그대로지만, 같은 알림 유형이라도
 * 수신자마다 카테고리가 다를 수 있어(AI_QUESTION — 멘션된 사람은 MENTION, 나머지는 ISSUE, WP-452) 이벤트에 명시한다.
 *
 * <p>statusName 은 STATUS_CHANGED 알림의 새 상태 이름(WP-869, 그 외·이름 없으면 null).
 */
public record InboxPushRequestedEvent(
    long tenantId,
    NotificationType type,
    PushCategory category,
    List<Long> recipientIds,
    Long actorId,
    Long issueId,
    Long eventId,
    Long wikiPageId,
    String eventTitle,
    String statusName) {

  /**
   * statusName 없이 만드는 생성자 — 상태 변경 알림이 아닌 모든 알림용. statusName 은 STATUS_CHANGED 의 새 상태 이름(WP-869)으로,
   * 푸시 문구를 「상태를 '검토 중'으로 변경했습니다」로 만든다(조사는 받침에 맞춘다).
   */
  public InboxPushRequestedEvent(
      long tenantId,
      NotificationType type,
      PushCategory category,
      List<Long> recipientIds,
      Long actorId,
      Long issueId,
      Long eventId,
      Long wikiPageId,
      String eventTitle) {
    this(
        tenantId,
        type,
        category,
        recipientIds,
        actorId,
        issueId,
        eventId,
        wikiPageId,
        eventTitle,
        null);
  }

  /**
   * 이슈·일정 알림용 — 노트 공유 알림이 아니면 wikiPageId 는 없고, 일정 제목은 싣지 않는다(가리킬 일정이 있으면 푸시가 일정 행에서 제목을 읽는다).
   * eventTitle 은 일정 행이 없는 취소 알림(WP-712)만 채운다.
   */
  public InboxPushRequestedEvent(
      long tenantId,
      NotificationType type,
      PushCategory category,
      List<Long> recipientIds,
      Long actorId,
      Long issueId,
      Long eventId) {
    this(tenantId, type, category, recipientIds, actorId, issueId, eventId, null, null);
  }

  /** 카테고리를 유형 기본값({@link PushCategory#of})으로 정하는 생성자 — 수신자별 분기가 없는 대부분의 알림용. */
  public InboxPushRequestedEvent(
      long tenantId,
      NotificationType type,
      List<Long> recipientIds,
      Long actorId,
      Long issueId,
      Long eventId) {
    this(
        tenantId, type, PushCategory.of(type), recipientIds, actorId, issueId, eventId, null, null);
  }
}
