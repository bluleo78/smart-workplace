package com.workplace.notify.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.realtime.UserAudienceResolver;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 알림 읽음 처리 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-64). 다른 탭·기기의 안읽음 배지와 목록을 맞추기 위해 수신자 본인에게만 보낸다.
 * 신규 알림은 기존 notify.created 가 담당한다. 반드시 쓰기 트랜잭션 안에서 호출해야 한다(AFTER_COMMIT).
 */
@Component
@RequiredArgsConstructor
public class NotificationChangeNotifier {

  private final ApplicationEventPublisher publisher;

  /** 읽음 처리 — ids 는 읽음 처리한 알림 id(전체 읽음이면 알 수 없어 빈 목록). */
  public void read(long recipientId, Collection<Long> ids) {
    publisher.publishEvent(
        new ResourceChangedEvent(
            "notification",
            ResourceChangedEvent.OP_UPDATED,
            UserAudienceResolver.SCOPE,
            recipientId,
            List.copyOf(ids),
            Map.of(),
            recipientId,
            Set.of()));
  }
}
