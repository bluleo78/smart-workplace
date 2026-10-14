package com.workplace.home.service;

import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.ai.AiMemoryReader;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@link AiMemoryReader} 구현(WP-381) — 홈 채팅과 같은 규칙(loadForChat: 공통 + 앱, 범위마다 유효 최신 50)으로 읽어 와이어 줄로
 * 바꾼다.
 *
 * <p>짧은 읽기 전용 트랜잭션을 <b>REQUIRES_NEW</b> 로 열어 요청 스레드의 TenantContext 로 GUC 를 넣고 읽는다(왜 새 트랜잭션이고 왜 호출자가
 * 트랜잭션 밖에서 부르는지는 {@link AiMemoryReader#readForEntry}). 조회 실패는 잡아 빈 목록으로 돌려준다.
 */
@Slf4j
@Component
public class AiMemoryEntryReader implements AiMemoryReader {

  private final AiMemoryService memoryService;
  private final TransactionTemplate tx;

  public AiMemoryEntryReader(AiMemoryService memoryService, PlatformTransactionManager txManager) {
    this.memoryService = memoryService;
    this.tx = new TransactionTemplate(txManager);
    // 바깥 트랜잭션이 있어도 참여하지 않는다 — 실패가 바깥을 rollback-only 로 만들지 않게(AiMemoryReader#readForEntry).
    this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    this.tx.setReadOnly(true);
  }

  /** 공통 + app 메모리를 새 읽기 트랜잭션으로 읽는다. 꺼짐·조회 실패면 빈 목록(기능은 메모리 없이 진행). */
  @Override
  public List<AiMemoryLine> readForEntry(long userId, String app) {
    try {
      AiMemoryService.ChatMemories m = tx.execute(s -> memoryService.loadForChat(userId, app));
      return m == null || !m.enabled() ? List.of() : m.items();
    } catch (RuntimeException e) {
      // 인터럽트로 실패했으면 플래그만 되살려 이 스레드의 주인이 인터럽트 상태를 잃지 않게 하고, 다시 던지지는 않는다 — 메모리는 부가
      // 기능이라 이 조회 때문에 기능을 실패시키지 않는다(홈 채팅 memoriesOrUnavailable 은 펌프 취소 경로가 있어 다시 던진다). 메일·채널
      // 따라잡기처럼 같은 스레드에서 ai-agent 를 블로킹 호출하는 진입점은 그 호출이 되살린 플래그를 보고 인터럽트로 끝난다.
      if (HomeInterruptions.isUserCancel(e)) Thread.currentThread().interrupt();
      log.warn("AI 메모리 조회 실패 — 메모리 없이 진행: user={} app={} {}", userId, app, e.getMessage());
      return List.of();
    }
  }
}
