package com.workplace.home.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.AiMemoryRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메모리 사용 시각 기록(WP-385 스펙 7) — 대화 블록에 실린 메모리, search_memory 결과, 다른 진입점에 실린 메모리의 id 를 받아 커밋 뒤(트랜잭션이
 * 없으면 바로) 전용 실행기에서 last_used_at 을 올린다. 응답을 늦추지 않으려고 비동기이고, 실패는 로그만 남긴다.
 *
 * <p>테넌트는 부른 스레드에서 잡아 실행기 스레드가 다시 세운다 — ai_memory 는 FORCE RLS 라 GUC 없이 UPDATE 하면 0행이 조용히 바뀐다. 이벤트
 * 대신 트랜잭션 동기화를 직접 쓰는 이유: 홈 채팅 펌프는 바깥 트랜잭션이 없어 @TransactionalEventListener 가 이벤트를 버린다.
 */
@Slf4j
@Component
public class AiMemoryUsageRecorder {

  /** 이 안에 이미 쓰인 행은 다시 쓰지 않는다(매 턴 같은 메모리가 실려도 UPDATE 는 시간당 한 번). */
  static final Duration MIN_INTERVAL = Duration.ofHours(1);

  private final AiMemoryRepository repo;
  private final TransactionTemplate tx;
  private volatile Executor executor;

  public AiMemoryUsageRecorder(
      AiMemoryRepository repo,
      PlatformTransactionManager txManager,
      @Qualifier("aiMemoryUsageExecutor") Executor executor) {
    this.repo = repo;
    this.executor = executor;
    // 실행기 스레드는 늘 독립 트랜잭션 — 끝난 바깥 트랜잭션 자원에 참여하지 않는다.
    this.tx = new TransactionTemplate(txManager);
    this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /** 실린 메모리 id 들의 사용 시각을 올리게 한다. 빈 목록·테넌트 없음은 무시. 트랜잭션 안이면 커밋 뒤에만(롤백되면 버린다). */
  public void record(long userId, Collection<Long> ids) {
    if (ids == null || ids.isEmpty()) return;
    Long tenantId = TenantContext.get();
    if (tenantId == null) return;
    List<Long> copy = List.copyOf(ids);
    Runnable submit = () -> executor.execute(() -> touch(tenantId, userId, copy));
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              submit.run();
            }
          });
    } else {
      submit.run();
    }
  }

  /** 실행기 스레드 — 테넌트를 세우고 짧은 트랜잭션으로 올린다. 끝나면 이전 테넌트로 되돌린다(풀 스레드에 남지 않게). */
  private void touch(long tenantId, long userId, List<Long> ids) {
    try {
      TenantContext.runAs(
          tenantId,
          () -> {
            OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
            tx.executeWithoutResult(s -> repo.touchUsed(userId, ids, now, now.minus(MIN_INTERVAL)));
          });
    } catch (RuntimeException e) {
      log.warn("메모리 사용 시각 갱신 실패(무시): tenant={} {}", tenantId, e.getMessage());
    }
  }

  /** 테스트 전용 — 실행기를 바꾸고 이전 것을 돌려준다(테스트가 끝에 되돌린다). */
  public Executor useExecutorForTest(Executor e) {
    Executor prev = this.executor;
    this.executor = e;
    return prev;
  }
}
