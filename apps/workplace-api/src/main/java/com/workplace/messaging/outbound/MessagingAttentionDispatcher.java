package com.workplace.messaging.outbound;

import com.workplace.messaging.outbound.MessagingDomainEvents.MessageCreatedEvent;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.MessagingAttentionService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * MessageCreatedEvent → 메시징 어텐션(암묵적 관련성) AI 발굴 트리거.
 *
 * <p>커밋 후 발사(AFTER_COMMIT)인 이유: {@code MessageService.create()} 트랜잭션 안에서 직접 호출하면 @Async 워커가 커밋 전
 * 제출돼, 워커가 새 트랜잭션에서 DB 재조회 시 방금 INSERT 한 메시지가 비가시(READ COMMITTED 레이스)일 수 있다 → maxId<=watermark 조기
 * return 으로 트리거 메시지 미분류(간헐 실패). 커밋 후 발사로 가시성을 보장한다.
 *
 * <p>directed(DM 또는 멘션 있음)는 요약 라이브 쿼리 경로이므로 제외 — 일반 채널 + 멘션 없는 메시지만 비동기 발굴 대상.
 *
 * <p>이 리스너는 동기로 실행되고(요청 스레드 정리 전 → TenantContext 살아있음), @Async 진입점 {@link
 * MessagingAttentionService#onChannelMessage}을 별도 빈 프록시 경유로 호출한다(self-invocation 회피 → @Async 정상 발화
 * + TenantContextTaskDecorator 가 테넌트 전파 → RLS 불변).
 */
@Component
@RequiredArgsConstructor
public class MessagingAttentionDispatcher {

  private final ChannelRepository channelRepo;
  private final MessagingAttentionService attentionService;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onMessageCreated(MessageCreatedEvent e) {
    // 일반 채널(!DM) + 멘션 없는 메시지만 암묵적 관련성 발굴 대상. mentions 는 non-null 리스트.
    if (!"DM".equals(channelRepo.findKind(e.channelId())) && e.message().mentions().isEmpty()) {
      attentionService.onChannelMessage(e.channelId());
    }
  }
}
