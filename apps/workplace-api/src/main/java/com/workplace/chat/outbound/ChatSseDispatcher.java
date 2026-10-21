package com.workplace.chat.outbound;

import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadProgressEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadReadEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.util.AfterCommit;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
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
 * <p>DB 를 바꾸는 이벤트(created/updated/deleted/read)는 커밋 직전(BEFORE_COMMIT)에 요청 트랜잭션 안에서 수신자를
 * 조회하고(커넥션·GUC 를 그대로 써 RLS 가 맞게 걸린다), 전송만 {@link AfterCommit} 로 커밋 뒤로 미뤄 커밋된 변경만 알린다(롤백되면 보내지 않는다).
 * 예전처럼 커밋 뒤 REQUIRES_NEW 로 다시 조회하면 요청 커넥션을 쥔 채 두 번째 커넥션을 빌려, 동시 쓰기가 풀 크기를 넘으면 모두가 서로를 기다리며
 * 멈췄다(WP-751).
 *
 * <p>transient 한 typing·progress 는 일반 @EventListener 로 받는다 — readOnly
 * 트랜잭션(notifyTyping·notifyProgress) 안에서 동기 발행되므로 그 트랜잭션에 합류해 같은 커넥션·GUC 로 수신자를 읽는다(REQUIRES_NEW 로
 * 보류하면 두 번째 커넥션이 필요해진다).
 */
@Component
@RequiredArgsConstructor
public class ChatSseDispatcher {

  private final SseRegistry registry;
  private final ChatThreadMemberRepository memberRepo;

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onCreated(ChatMessageCreatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    p.put("authorId", e.actor().id());
    p.put("authorUsername", e.actor().username());
    p.put("authorName", e.actor().name());
    p.put("authorKind", e.actor().kind());
    p.put("body", e.body());
    p.put("mentions", e.mentions().stream().map(this::mention).toList());
    p.put("createdAt", e.occurredAt().toString());
    p.put("editedAt", null);
    p.put("deleted", false);
    // 첨부 파일·드라이브 링크를 SSE 페이로드에 포함 — 프론트 ChatMessageResponse 캐스트와 필드 일치.
    p.put("attachments", e.attachments());
    p.put("driveLinks", e.driveLinks());
    p.put("question", e.question());
    Collection<Long> to = memberRepo.findMemberIds(e.threadId());
    AfterCommit.run(() -> registry.fanOut(to, "chat.message.created", p));
  }

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onUpdated(ChatMessageUpdatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    p.put("body", e.body());
    p.put("mentions", e.mentions().stream().map(this::mention).toList());
    p.put("editedAt", e.editedAt() == null ? null : e.editedAt().toString());
    Collection<Long> to = memberRepo.findMemberIds(e.threadId());
    AfterCommit.run(() -> registry.fanOut(to, "chat.message.updated", p));
  }

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onDeleted(ChatMessageDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("id", e.messageId());
    Collection<Long> to = memberRepo.findMemberIds(e.threadId());
    AfterCommit.run(() -> registry.fanOut(to, "chat.message.deleted", p));
  }

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onRead(ChatThreadReadEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("userId", e.userId());
    p.put("lastReadMessageId", e.lastReadMessageId());
    Collection<Long> to = memberRepo.findMemberIds(e.threadId());
    AfterCommit.run(() -> registry.fanOut(to, "chat.thread.read", p));
  }

  // notifyTyping 의 readOnly 트랜잭션에 합류해 같은 커넥션·GUC 로 수신자를 읽는다(트랜잭션 밖 발행이면 새로 연다).
  @Transactional
  @EventListener
  public void onTyping(ChatThreadTypingEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("userId", e.actor().id());
    p.put("name", e.actor().name());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.thread.typing", p);
  }

  // 진행 이벤트도 typing 과 같이 발행한 트랜잭션에 합류한다.
  @Transactional
  @EventListener
  public void onProgress(ChatThreadProgressEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("threadId", e.threadId());
    p.put("streamId", e.streamId());
    p.put("agentId", e.agentId());
    p.put("agentName", e.agentName());
    p.put("phase", e.phase());
    p.put("steps", e.steps());
    registry.fanOut(memberRepo.findMemberIds(e.threadId()), "chat.message.progress", p);
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
