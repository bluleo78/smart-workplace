package com.workplace.home.service;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.TextEmbeddingRepository;
import java.util.Optional;
import java.util.concurrent.Executor;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메모리·대화 턴 임베딩 채우기(WP-383·384) — 저장·내용 수정 커밋 뒤 전용 단일 스레드에서 워커 임베딩을 받아 그 행에 쓴다. 임베딩 HTTP(최대 5초)는 DB
 * 트랜잭션 밖에서 한다(읽기 → 임베딩 → 쓰기, 읽기·쓰기는 각각 짧은 독립 트랜잭션). 쓰기는 그사이 내용이 바뀌지 않았고 아직 비어 있을 때만 — 늦게 끝난 옛 임베딩이
 * 새 내용을 덮지 않는다.
 *
 * <p>실패(워커 장애·큐 넘침)는 버린다 — {@link TextEmbeddingBackfillScheduler} 가 embedding IS NULL 행을 다시 채운다.
 */
@Slf4j
@Service
public class TextEmbeddingService {

  /** 임베딩을 채울 행 — 커밋 뒤 이벤트로 받는다. tenantId 는 발행 스레드의 활성 테넌트(실행기 스레드가 RLS GUC 를 다시 세운다). */
  public record Requested(Long tenantId, Target target, long id) {}

  /** 대상 테이블 — 선언 순서가 백필 순서다(메모리 먼저). */
  public enum Target {
    /** ai_memory(WP-383). */
    MEMORY
  }

  /** 한 행 채우기 결과 — FAILED(워커 실패)면 백필이 이번 주기를 멈춘다. */
  public enum Result {
    FILLED,
    SKIPPED,
    FAILED
  }

  private final TextEmbedder embedder;
  private final TextEmbeddingRepository repo;
  private final TransactionTemplate tx;
  private volatile Executor executor;

  public TextEmbeddingService(
      TextEmbedder embedder,
      TextEmbeddingRepository repo,
      PlatformTransactionManager txManager,
      @Qualifier("textEmbeddingExecutor") Executor executor) {
    this.embedder = embedder;
    this.repo = repo;
    this.executor = executor;
    // 커밋 뒤(afterCompletion)·백필에서 부르므로 늘 독립 트랜잭션 — 끝난 바깥 트랜잭션 자원에 참여하지 않는다.
    this.tx = new TransactionTemplate(txManager);
    this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /** 커밋된 저장만 실행기에 넘긴다 — 롤백된 저장은 임베딩하지 않는다. 꺼져 있으면 아무것도 하지 않는다(백필도 쉰다). */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onRequested(Requested e) {
    if (!embedder.enabled() || e.tenantId() == null) return;
    executor.execute(() -> inTenant(e.tenantId(), () -> embedOne(e.target(), e.id())));
  }

  /**
   * 한 행을 채운다 — 읽기(짧은 tx) → 임베딩(tx 밖) → 쓰기(짧은 tx). 이미 채웠거나 지워졌으면 SKIPPED, 워커가 실패하면 FAILED. 커밋 뒤 작업과
   * 백필이 같은 메서드를 쓴다. 호출자가 TenantContext 를 세운다.
   */
  public Result embedOne(Target target, long id) {
    String text =
        tx.execute(
            s ->
                switch (target) {
                  case MEMORY -> repo.memoryText(id);
                });
    if (text == null) return Result.SKIPPED;
    Optional<float[]> vec = embedder.embedDocument(text);
    if (vec.isEmpty()) return Result.FAILED;
    String literal = TextEmbeddingRepository.vectorLiteral(vec.get());
    Integer written =
        tx.execute(
            s ->
                switch (target) {
                  case MEMORY -> repo.writeMemory(id, text, literal);
                });
    return written != null && written > 0 ? Result.FILLED : Result.SKIPPED;
  }

  /** 발행 테넌트로 실행하고 끝나면 되돌린다(풀 스레드에 남지 않게). 실패는 로그만 — 백필이 다시 채운다. */
  static Result inTenant(long tenantId, Supplier<Result> work) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return work.get();
    } catch (RuntimeException ex) {
      log.warn("임베딩 채우기 실패(백필로 미룸): tenant={} {}", tenantId, ex.getMessage());
      return Result.FAILED;
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /**
   * 테스트 전용 — 커밋 뒤 작업을 호출 스레드에서 바로 돌려 시간 대기 없이 확인한다. 이전 실행기를 돌려주므로 테스트가 끝에 되돌려 공유 컨텍스트를 오염시키지 않는다.
   */
  public Executor useExecutorForTest(Executor e) {
    Executor prev = this.executor;
    this.executor = e;
    return prev;
  }
}
