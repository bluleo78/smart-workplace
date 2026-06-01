package com.workplace.chat.outbound;

import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadReadEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.realtime.SseRegistry;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * chat 도메인 이벤트를 thread 전 멤버에게 SSE fan-out 한다.
 *
 * <p>기존 {@link ChatEventDispatcher}(AGENT 멘션 시에만 ai-agent 발사)와 완전히 분리 — 본 디스패처는 멘션 필터를 거치지 않고 모든
 * 메시지/이벤트를 thread 전 멤버에게 보낸다. self-echo 는 허용(발신자 본인 포함) — 멀티기기 동기화 + 프론트가 messageId 로 optimistic
 * dedup, read/typing 은 본인 userId 로 무시.
 *
 * <p>DB 를 바꾸는 이벤트(created/updated/deleted/read)는 AFTER_COMMIT 으로 커밋된 데이터만 push 하고, transient 한
 * typing 은 트랜잭션이 없으므로 일반 @EventListener 로 받는다.
 */
@Component
@RequiredArgsConstructor
public class ChatSseDispatcher {

  private final SseRegistry registry;
  private final ChatThreadMemberRepository memberRepo;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCreated(ChatMessageCreatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    p.put("authorId", e.actor().id());
    p.put("authorName", e.actor().name());
    p.put("authorKind", e.actor().kind());
    p.put("body", e.body());
    p.put("mentions", e.mentions().stream().map(this::mention).toList());
    p.put("createdAt", e.occurredAt().toString());
    p.put("editedAt", null);
    p.put("deleted", false);
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.message.created", p);
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onUpdated(ChatMessageUpdatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    p.put("body", e.body());
    p.put("mentions", e.mentions().stream().map(this::mention).toList());
    p.put("editedAt", e.editedAt() == null ? null : e.editedAt().toString());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.message.updated", p);
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onDeleted(ChatMessageDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.message.deleted", p);
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onRead(ChatThreadReadEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("userId", e.userId());
    p.put("lastReadMessageId", e.lastReadMessageId());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.thread.read", p);
  }

  @EventListener
  public void onTyping(ChatThreadTypingEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("userId", e.actor().id());
    p.put("name", e.actor().name());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.thread.typing", p);
  }

  private Map<String, Object> mention(UserSummary u) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", u.id());
    m.put("username", u.username());
    m.put("name", u.name());
    m.put("kind", u.kind());
    return m;
  }
}
