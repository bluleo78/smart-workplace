package com.workplace.messaging.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.outbound.TenantAudienceResolver;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 채널·DM 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-62). 공개 채널의 존재·이름·보관 상태는 테넌트 전원의 탐색 목록에 보이므로
 * TENANT 로, 비공개 채널과 멤버십 변경은 CHANNEL(멤버) 로 보낸다. 제거·나가기·하드삭제는 커밋 후 명단에서 빠지므로 호출자가 extra 로 넘긴다.
 * payload 에 채널명은 싣지 않는다(비공개 채널명 유출 방지). 반드시 쓰기 트랜잭션 안에서 호출해야 한다(AFTER_COMMIT).
 */
@Component
@RequiredArgsConstructor
public class ChannelChangeNotifier {

  private final ApplicationEventPublisher publisher;

  /** 채널 자체 변경(생성·이름·보관·삭제). isPublic 이면 테넌트 전원, 아니면 멤버 + extra. */
  public void channelChanged(
      String op, long channelId, boolean isPublic, Long actorId, Collection<Long> extra) {
    if (isPublic) {
      publish(
          "channel",
          op,
          TenantAudienceResolver.SCOPE,
          TenantContext.require(),
          channelId,
          actorId,
          extra);
    } else {
      publish("channel", op, ChannelAudienceResolver.SCOPE, channelId, channelId, actorId, extra);
    }
  }

  /** 멤버십 변경(참여·추가·제거·나가기·역할) — 멤버 + extra(제거된 사용자). */
  public void membershipChanged(long channelId, Long actorId, Collection<Long> extra) {
    publish(
        "channel",
        ResourceChangedEvent.OP_UPDATED,
        ChannelAudienceResolver.SCOPE,
        channelId,
        channelId,
        actorId,
        extra);
  }

  /** DM 생성 — DM 멤버 전원(사이드바 DM 목록). */
  public void dmCreated(long channelId, Long actorId) {
    publish(
        "dm",
        ResourceChangedEvent.OP_CREATED,
        ChannelAudienceResolver.SCOPE,
        channelId,
        channelId,
        actorId,
        Set.of());
  }

  private void publish(
      String resource,
      String op,
      String scope,
      long scopeId,
      long channelId,
      Long actorId,
      Collection<Long> extra) {
    publisher.publishEvent(
        new ResourceChangedEvent(
            resource,
            op,
            scope,
            scopeId,
            List.of(channelId),
            Map.of("channelId", channelId),
            actorId,
            Set.copyOf(extra)));
  }
}
