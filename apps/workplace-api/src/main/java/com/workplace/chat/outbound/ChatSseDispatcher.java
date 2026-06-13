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
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
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
 * typing 은 일반 @EventListener 로 받는다(commit 이후가 아닌 발행 시점 동기 실행).
 *
 * <p>모든 핸들러에 {@code @Transactional(REQUIRES_NEW)} 를 부여한다. AFTER_COMMIT 핸들러는 원래 트랜잭션이 이미 커밋된 후 동기
 * 실행되어 활성 트랜잭션이 없다(트랜잭션-로컬 GUC 도 이미 해제). onTyping 은 {@code notifyTyping} 의 readOnly 트랜잭션 안에서 동기
 * 발행되어 호출되지만, REQUIRES_NEW 가 그 트랜잭션을 잠시 보류하고 새 트랜잭션을 연다. 어느 경우든 새 트랜잭션 진입 시
 * TenantAwareTransactionManager.doBegin 이 여전히 요청 스레드에 설정된 TenantContext 를 읽어 트랜잭션-로컬 GUC 를
 * 재주입하므로(REQUIRES_NEW 가 없으면 보류·커밋 후 컨텍스트에서 GUC 가 비어 RLS 가 chat_thread_member 를 전부 차단 → fail-closed
 * 빈 fan-out), findMemberIds 가 올바른 테넌트 멤버를 반환한다. (#214 MessageSseDispatcher 패턴)
 */
@Component
@RequiredArgsConstructor
public class ChatSseDispatcher {

  private final SseRegistry registry;
  private final ChatThreadMemberRepository memberRepo;

  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
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

  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
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

  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onDeleted(ChatMessageDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.message.deleted", p);
  }

  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onRead(ChatThreadReadEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("userId", e.userId());
    p.put("lastReadMessageId", e.lastReadMessageId());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.thread.read", p);
  }

  // onTyping 은 notifyTyping 의 readOnly 트랜잭션 안에서 동기 발행되어 실행된다. REQUIRES_NEW 가 그 트랜잭션을 보류하고
  // 새 트랜잭션을 열면 doBegin 이 TenantContext 에서 GUC 를 재주입 — 나머지 4개 AFTER_COMMIT 핸들러와 동일하게
  // findMemberIds 가 RLS fail-closed(빈 fan-out) 되지 않는다.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
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
