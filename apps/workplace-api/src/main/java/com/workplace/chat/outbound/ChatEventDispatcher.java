package com.workplace.chat.outbound;

import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.EventEnvelope;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * ChatMessageCreatedEvent → ai-agent 발사. 발사 조건:
 *
 * <ul>
 *   <li>props.enabled() == true
 *   <li>actor.kind() != "AGENT" (self-loop 차단)
 *   <li>mentions 에 kind == "AGENT" 가 1명 이상
 * </ul>
 *
 * 다른 모든 조건은 skip — 일반 사람간 메시지나 mention 안 한 메시지는 ai-agent 로 가지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ChatEventDispatcher {

  private final AiAgentEventClient client;
  private final AiAgentProperties props;

  // ChatSseDispatcher 와 달리 @Transactional(REQUIRES_NEW) 가 필요 없다 — 이 핸들러는 DB 를 읽지 않고
  // 이벤트 payload 만 읽어 outbound HTTP 발사하므로 RLS 보호 테이블 조회가 없어 GUC/트랜잭션이 불필요하다.
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  @Async("aiAgentEventExecutor")
  public void onChatMessageCreated(ChatMessageCreatedEvent e) {
    if (!props.enabled()) return;
    if ("AGENT".equals(e.actor().kind())) return;
    if (e.mentions().stream().noneMatch(m -> "AGENT".equals(m.kind()))) return;
    client.publish(new EventEnvelope("chat.message.posted", buildPayload(e)));
  }

  private Map<String, Object> buildPayload(ChatMessageCreatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("projectKey", e.projectKey());
    p.put("issueKey", e.issueKey());
    p.put("issueId", e.issueId());
    // #368: AI 가 이슈 컨텍스트를 인지하도록 제목·상태·본문 동봉. body 는 null 가능(CLOB).
    p.put("issueTitle", e.issueTitle());
    p.put("issueStatus", e.issueStatus());
    p.put("issueBody", e.issueBody());
    p.put("threadId", e.threadId());
    p.put("messageId", e.messageId());
    p.put("actor", toMap(e.actor()));
    p.put("body", e.body());
    p.put("mentions", e.mentions().stream().map(this::toMap).toList());
    p.put("occurredAt", e.occurredAt().toString());
    return p;
  }

  private Map<String, Object> toMap(UserSummary u) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", u.id());
    m.put("username", u.username());
    m.put("name", u.name());
    m.put("kind", u.kind());
    return m;
  }
}
