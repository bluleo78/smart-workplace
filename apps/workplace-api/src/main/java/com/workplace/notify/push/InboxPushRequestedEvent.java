package com.workplace.notify.push;

import com.workplace.notify.dto.NotificationType;
import java.util.List;

/**
 * 인박스 알림이 생성됐음을 알리는 notify 내부 이벤트. NotificationService 가 insert 직후 발행하고, 커밋 후 PushDispatcher 가 푸시로
 * 내보낸다. recipientIds 는 실제 insert 된 수신자(actor 제외·중복 제거 후). issueId/eventId 중 유형에 맞는 하나만 채워진다.
 */
public record InboxPushRequestedEvent(
    long tenantId,
    NotificationType type,
    List<Long> recipientIds,
    Long actorId,
    Long issueId,
    Long eventId) {}
