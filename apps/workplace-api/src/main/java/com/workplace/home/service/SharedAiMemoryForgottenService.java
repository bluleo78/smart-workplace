package com.workplace.home.service;

import com.workplace.global.ai.MemoryTextNormalizer;
import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.SharedAiMemoryForgottenRepository;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.home.service.SharedSpace.SpaceKey;
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
 * 공간 지운 기록(WP-386 스펙 4절) — 개인 AiMemoryForgottenService(WP-385)의 공간판. 관리자가 지운 AI 항목을 기억해 배경 추출·정리가
 * 같은 말을 다시 저장하지 못하게 한다.
 *
 * <ul>
 *   <li>넣기({@link #remember}): 관리 권한자가 AI_EXTRACTED·AI_CLEANED 항목을 지움, AI 의 ADDED 를 되돌림.
 *   <li>막기({@link #isForgotten}): 배경 추출·정리 결과만(정규화 같음 또는 거리 ≤ 0.45).
 *   <li>해제({@link #release}): 사람의 직접 추가·요청 — 정규화 같은 것은 지금, 의미가 가까운 것은 커밋 뒤 질의 임베딩으로.
 * </ul>
 */
@Slf4j
@Service
public class SharedAiMemoryForgottenService {

  /** 해제의 의미 판정 질의 임베딩 대기 — 커밋 뒤 배경이라 검색과 같은 5초. */
  static final Duration RELEASE_EMBED_WAIT = Duration.ofSeconds(5);

  /** 넣기 한 번에 커밋 뒤 임베딩을 거는 최대 행 수 — 넘으면 백필에 맡긴다(단일 스레드 실행기를 몰아 막지 않게). */
  static final int EMBED_EVENTS_MAX = 20;

  /** 커밋 뒤 의미 해제 요청 — tenantId 는 발행 스레드의 활성 테넌트. */
  public record ReleaseRequested(Long tenantId, String spaceType, Long spaceId, String content) {}

  private final SharedAiMemoryForgottenRepository repo;
  private final TextEmbedder embedder;
  private final ApplicationEventPublisher events;
  private final TransactionTemplate tx;
  private volatile Executor executor;

  public SharedAiMemoryForgottenService(
      SharedAiMemoryForgottenRepository repo,
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
   * 지운 내용을 기록한다(호출자 트랜잭션 안). 한 번에 상한을 넘게 오면 뒤쪽 SPACE_CAP 개만 넣고, 넣은 뒤 공간 상한을 넘는 오래된 기록을 지운다. 임베딩은 커밋
   * 뒤 채운다(롤백되면 요청도 사라진다 — 20개를 넘게 넣으면 백필이 채운다).
   */
  public void remember(SpaceKey k, List<String> contents) {
    if (contents == null || contents.isEmpty()) return;
    int n = contents.size();
    int cap = SharedAiMemoryForgottenRepository.SPACE_CAP;
    List<Long> ids = repo.insertAll(k, n > cap ? contents.subList(n - cap, n) : contents);
    repo.trimToCap(k);
    if (ids.size() > EMBED_EVENTS_MAX) return;
    for (long id : ids) events.publishEvent(TextEmbeddingService.Requested.sharedForgotten(id));
  }

  /**
   * 거절한 결과 문장을 지운 기록에 남긴다(호출자 트랜잭션 안) — AI 의 고침·합침을 되돌리면 같은 대화를 다시 읽는 배경 추출이 같은 결과를 다시 내지 못하게(개인
   * AiMemoryForgottenService#rejectReplaced 의 공간판). 되돌린 뒤에도 남는 문장(previousContents)과 정규화로 같으면 넣지
   * 않는다: 넣으면 되살린 그 항목 자체를 막는다.
   */
  public void rejectReplaced(SpaceKey k, List<String> previousContents, String rejected) {
    String key = MemoryTextNormalizer.normalize(rejected);
    boolean stillThere =
        previousContents.stream().anyMatch(c -> MemoryTextNormalizer.normalize(c).equals(key));
    if (!stillThere) remember(k, List.of(rejected));
  }

  /** 사람이 직접 다시 저장한 내용과 겹치는 기록을 지운다(호출자 트랜잭션 안) — 정규화 같은 것은 지금, 의미가 가까운 것은 커밋 뒤. */
  public void release(SpaceKey k, String content) {
    repo.deleteMatching(k, MemoryTextNormalizer.normalize(content), null, 0);
    events.publishEvent(new ReleaseRequested(TenantContext.get(), k.type(), k.id(), content));
  }

  /** 커밋된 해제만 실행기에 넘긴다 — 임베딩이 꺼져 있으면 정규화 해제만으로 끝낸다. */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onReleaseRequested(ReleaseRequested e) {
    if (!embedder.enabled() || e.tenantId() == null) return;
    executor.execute(() -> releaseSemantic(e));
  }

  /** 질의 임베딩(트랜잭션 밖) → 거리 상한 이하 기록 지우기(짧은 독립 트랜잭션). 실패는 로그만 — 공간·내용은 싣지 않는다. */
  void releaseSemantic(ReleaseRequested e) {
    try {
      TenantContext.runAs(
          e.tenantId(),
          () -> {
            Optional<float[]> vec = embedder.embedQuery(e.content(), RELEASE_EMBED_WAIT);
            if (vec.isEmpty()) return;
            String literal = TextEmbeddingRepository.vectorLiteral(vec.get());
            SpaceKey k = SpaceKey.of(e.spaceType(), e.spaceId());
            tx.executeWithoutResult(
                s ->
                    repo.deleteMatching(
                        k,
                        MemoryTextNormalizer.normalize(e.content()),
                        literal,
                        AiMemoryRanker.SEMANTIC_MAX_DISTANCE));
          });
    } catch (RuntimeException ex) {
      log.warn("공용 지운 기록 의미 해제 실패(무시): tenant={} {}", e.tenantId(), ex.getMessage());
    }
  }

  /** 배경 결과가 지운 기록과 겹치는가(호출자 트랜잭션 안) — 정규화 같음 또는 vec(결과 문장의 질의 임베딩, 없으면 null)과의 거리 ≤ 0.45. */
  public boolean isForgotten(SpaceKey k, String content, float[] vec) {
    return repo.anyMatch(
        k,
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
