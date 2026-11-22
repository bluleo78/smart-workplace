package com.workplace.auth.service;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.service.AgentKeyStreamEvents.AgentKeyRevoked;
import com.workplace.auth.service.AgentKeyStreamEvents.AgentStreamOwnerDeleted;
import com.workplace.global.realtime.SseRegistry;
import java.time.OffsetDateTime;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * AI 키 폐기·AI 삭제 → 그 키로 연 이벤트 스트림 종료(WP-2008). 인증 필터는 새 요청만 막으므로 이미 열린 장수명 스트림은 서버가 닫아야 한다.
 *
 * <p>두 경로다. (1) 이 파드에서 일어난 폐기·삭제는 커밋 뒤 리스너가 즉시 닫는다. (2) 다른 api 파드에서 일어난 것은 이 파드가 알 수 없어, 30초마다 열린
 * 키가 아직 활성인지 DB 로 확인해 닫는다(만료·행 삭제도 같이 잡는다).
 *
 * <p>이벤트를 내는 폐기는 AgentApiKeyService.revoke 뿐이다 — 관리 키 회전·만료 정리처럼 이벤트 없이 키를 못 쓰게 하는 경로와, 폐기 커밋과 같은 때
 * 열린 스트림(리스너가 지난 뒤 등록됨)은 (2) 가 다음 주기(최대 30초)에 닫는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AgentKeyStreamCloser {
  private final SseRegistry sseRegistry;
  private final AgentApiKeyRepository apiKeys;

  /** 커밋된 키 폐기 → 그 키의 스트림만 닫는다(인메모리라 동기 처리). */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onKeyRevoked(AgentKeyRevoked e) {
    sseRegistry.closeByKey(e.keyId());
  }

  /** 커밋된 AI 완전 삭제 → 그 AI 의 모든 스트림을 닫는다. */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onAgentDeleted(AgentStreamOwnerDeleted e) {
    sseRegistry.closeAll(e.userId());
  }

  /**
   * 열린 AI 키 스트림의 키가 아직 활성인지 확인해 아니면 닫는다. 예외는 삼켜 로그만 남긴다 — 주기 작업이 한 번의 오류로 멈추면 안전망이 사라진다.
   * agent_api_key 는 RLS 가 없어 TenantContext 없이 조회한다.
   */
  @Scheduled(fixedRate = 30_000)
  public void revalidate() {
    try {
      Set<Long> open = sseRegistry.openAgentKeyIds();
      if (open.isEmpty()) return;
      Set<Long> active = apiKeys.findActiveIds(open, OffsetDateTime.now());
      int closed = sseRegistry.closeInactiveKeys(open, active);
      if (closed > 0) log.info("비활성 AI 키의 이벤트 스트림 {}개를 닫았다", closed);
    } catch (RuntimeException ex) {
      log.warn("AI 키 스트림 주기 확인 실패", ex);
    }
  }
}
