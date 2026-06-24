package com.workplace.messaging.outbound;

import com.workplace.global.dto.MentionResponse;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.messaging.outbound.MessagingDomainEvents.MessageAiTriggerEvent;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * MessageAiTriggerEvent → ai-agent 발사. 트리거 판단은 MessageService.create 에서 끝났으므로 디스패처는 enabled 가드 후 단순
 * forward 만 한다. AFTER_COMMIT + aiAgentEventExecutor(별도 풀)로 도메인 응답을 막지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MessagingAiDispatcher {

  private final AiAgentEventClient client;
  private final AiAgentProperties props;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  @Async("aiAgentEventExecutor")
  public void onAiTrigger(MessageAiTriggerEvent e) {
    if (!props.enabled()) return;
    client.publish(new EventEnvelope("messaging.message.posted", buildPayload(e)));
  }

  private Map<String, Object> buildPayload(MessageAiTriggerEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("channelId", e.channelId());
    p.put("channelKind", e.channelKind());
    p.put("messageId", e.messageId());
    p.put("respondAsAgentId", e.respondAsAgentId());
    p.put("actor", actorMap(e));
    p.put("body", e.body());
    p.put("mentions", e.mentions().stream().map(this::mentionMap).toList());
    // null 이면 인라인 멘션 — ai-agent 가 바인딩하지 않는다(payload 엔 null 로 전달).
    p.put("triggerParentMessageId", e.triggerParentMessageId());
    p.put("occurredAt", e.occurredAt().toString());
    return p;
  }

  private Map<String, Object> actorMap(MessageAiTriggerEvent e) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", e.actorId());
    m.put("name", e.actorName());
    m.put("kind", e.actorKind());
    return m;
  }

  private Map<String, Object> mentionMap(MentionResponse u) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", u.id());
    m.put("username", u.username());
    m.put("name", u.name());
    m.put("kind", u.kind());
    return m;
  }
}
