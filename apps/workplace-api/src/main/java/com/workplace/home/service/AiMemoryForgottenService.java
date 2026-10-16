package com.workplace.home.service;

import com.workplace.global.ai.MemoryTextNormalizer;
import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.AiMemoryForgottenRepository;
import com.workplace.home.repository.TextEmbeddingRepository;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 지운 기록(WP-385 스펙 6) — 사용자가 지우게 한 메모리를 기억해 배경 정리가 같은 말을 다시 저장하지 못하게 한다.
 *
 * <ul>
 *   <li>넣기({@link #remember}): 설정 지움·forget_memory·모두 지우기·결과 줄 「저장」 되돌리기·「AI가 정리한 기록」의 ADDED 되돌리기.
 *       서버가 정리로 지운 것(FORGET·DECAYED·MERGE 로 사라진 원본)은 넣지 않는다.
 *   <li>해제({@link #release}): 사용자가 직접 다시 저장하면(remember_memory·설정 직접 추가·결과 줄 「잊음」 되돌리기) 겹치는 기록을 지운다
 *       — 정규화 같은 것은 그 트랜잭션에서 바로, 의미가 가까운 것은 커밋 뒤 질의 임베딩으로(요청 트랜잭션이 워커 HTTP 를 기다리지 않게).
 *   <li>판정({@link #isForgotten}): 배경 정리 결과만 막는다.
 * </ul>
 */
@Slf4j
@Service
public class AiMemoryForgottenService {

  /** 해제의 의미 판정 질의 임베딩 대기 — 커밋 뒤 배경이라 검색과 같은 5초. */
  static final Duration RELEASE_EMBED_WAIT = Duration.ofSeconds(5);

  /** 넣기 한 번에 커밋 뒤 임베딩을 거는 최대 행 수 — 넘으면 백필에 맡긴다. */
  static final int EMBED_EVENTS_MAX = 20;

  /** 커밋 뒤 의미 해제 요청 — tenantId 는 발행 스레드의 활성 테넌트. */
  public record ReleaseRequested(Long tenantId, long userId, String content) {}

  private final AiMemoryForgottenRepository repo;
  private final TextEmbedder embedder;
  private final ApplicationEventPublisher events;
  private final TransactionTemplate tx;
  private volatile Executor executor;

  public AiMemoryForgottenService(
      AiMemoryForgottenRepository repo,
      TextEmbedder embedder,
      ApplicationEventPublisher events,
      PlatformTransactionManager txManager,
      @Qualifier("textEmbeddingExecutor") Executor executor) {
    this.repo = repo;
    this.embedder = embedder;
    this.events = events;
    this.executor = executor;
    this.tx = new TransactionTemplate(txManager);
    this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /**
   * 지운 내용을 기록한다(호출자 트랜잭션 안). 한 번에 상한을 넘게 오면 뒤쪽 USER_CAP 개만 넣고, 넣은 뒤 사용자당 상한을 넘는 오래된 기록을 지운다. 임베딩은
   * 커밋 뒤 채운다(롤백되면 요청도 사라진다 — 20개를 넘게 넣으면 백필이 채운다).
   */
  public void remember(long userId, List<String> contents) {
    if (contents == null || contents.isEmpty()) return;
    int n = contents.size();
    List<String> kept =
        n > AiMemoryForgottenRepository.USER_CAP
            ? contents.subList(n - AiMemoryForgottenRepository.USER_CAP, n)
            : contents;
    List<Long> ids = repo.insertAll(userId, kept);
    repo.trimToCap(userId);
    // 한 번에 많이(모두 지우기) 넣으면 행마다 커밋 뒤 임베딩을 걸지 않는다 — 단일 스레드 실행기를 몰아 막지 않게 백필(1분 50개)이 채운다.
    if (ids.size() > EMBED_EVENTS_MAX) return;
    for (long id : ids) events.publishEvent(TextEmbeddingService.Requested.forgotten(id));
  }

  /**
   * 거절한 결과 문장을 지운 기록에 남긴다(호출자 트랜잭션 안) — 고침·합침을 되돌리면 같은 대화를 다시 읽는 배경 정리가 같은 결과를 다시 내지 못하게. 되돌린 뒤에도
   * 남는 문장(previousContents — 범위·기한만 바꾼 고침, 원본 하나의 문장으로 합친 합침)과 정규화로 같으면 넣지 않는다: 넣으면 되살린 그 메모리 자체를
   * 막는다. 채팅 결과 줄 updated 되돌리기와 「AI가 정리한 기록」 되돌리기가 같은 규칙을 쓴다.
   */
  public void rejectReplaced(long userId, List<String> previousContents, String rejected) {
    String key = MemoryTextNormalizer.normalize(rejected);
    boolean stillThere =
        previousContents.stream().anyMatch(c -> MemoryTextNormalizer.normalize(c).equals(key));
    if (!stillThere) remember(userId, List.of(rejected));
  }

  /** 사용자가 직접 다시 저장한 내용과 겹치는 기록을 지운다(호출자 트랜잭션 안) — 정규화 같은 것은 지금, 의미가 가까운 것은 커밋 뒤. */
  public void release(long userId, String content) {
    repo.deleteMatching(userId, MemoryTextNormalizer.normalize(content), null, 0);
    events.publishEvent(new ReleaseRequested(TenantContext.get(), userId, content));
  }

  /** 커밋된 해제만 실행기에 넘긴다 — 임베딩이 꺼져 있으면 정규화 해제만으로 끝낸다. */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onReleaseRequested(ReleaseRequested e) {
    if (!embedder.enabled() || e.tenantId() == null) return;
    executor.execute(() -> releaseSemantic(e.tenantId(), e.userId(), e.content()));
  }

  /** 질의 임베딩(트랜잭션 밖) → 거리 상한 이하 기록 지우기(짧은 독립 트랜잭션). 실패는 로그만. */
  void releaseSemantic(long tenantId, long userId, String content) {
    try {
      TenantContext.runAs(
          tenantId,
          () -> {
            Optional<float[]> vec = embedder.embedQuery(content, RELEASE_EMBED_WAIT);
            if (vec.isEmpty()) return;
            String literal = TextEmbeddingRepository.vectorLiteral(vec.get());
            tx.executeWithoutResult(
                s ->
                    repo.deleteMatching(
                        userId,
                        MemoryTextNormalizer.normalize(content),
                        literal,
                        AiMemoryRanker.SEMANTIC_MAX_DISTANCE));
          });
    } catch (RuntimeException ex) {
      log.warn("지운 기록 의미 해제 실패(무시): tenant={} {}", tenantId, ex.getMessage());
    }
  }

  /** 배경 정리 결과가 지운 기록과 겹치는가(호출자 트랜잭션 안) — 정규화 같음 또는 vec(결과 문장의 질의 임베딩, 없으면 null)과의 거리 ≤ 0.45. */
  public boolean isForgotten(long userId, String content, float[] vec) {
    return repo.anyMatch(
        userId,
        MemoryTextNormalizer.normalize(content),
        vec == null ? null : TextEmbeddingRepository.vectorLiteral(vec),
        AiMemoryRanker.SEMANTIC_MAX_DISTANCE);
  }

  /** 테스트 전용 — 실행기를 바꾸고 이전 것을 돌려준다. */
  public Executor useExecutorForTest(Executor e) {
    Executor prev = this.executor;
    this.executor = e;
    return prev;
  }
}
