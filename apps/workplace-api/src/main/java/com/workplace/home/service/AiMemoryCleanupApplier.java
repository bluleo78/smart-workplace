package com.workplace.home.service;

import com.workplace.home.outbound.MemoryCleanupMessages.Op;
import com.workplace.home.repository.AiMemoryCleanupRepository;
import com.workplace.home.repository.AiMemoryRepository;
import com.workplace.user.service.AiPreferenceService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 배경 정리 3단 — 한 트랜잭션에서 경계 갱신(세션 행 잠금) → 사용자 잠금 → 꺼짐 재확인 → 개인 ops → 참여자(WP-386) 적용(WP-385 스펙 5.5·9).
 * 경계를 먼저 올리는 이유: 조건부 UPDATE 가 세션 행을 잠가 같은 세션의 다른 회차·세션 삭제와 겹치지 않게 하고, 이미 움직였으면(다른 파드가 처리) 아무것도 바꾸지
 * 않는다. 경계는 수집 때의 마지막 id 로만 올라 정리 중 온 메시지는 다음 회차에 남는다. 호출자가 TenantContext 를 세운다.
 */
@Component
public class AiMemoryCleanupApplier {

  private final AiMemoryCleanupRepository cleanupRepo;
  private final AiMemoryRepository memoryRepo;
  private final AiPreferenceService preferences;
  private final AiMemoryCleanupOpApplier opApplier;
  private final TransactionTemplate tx;

  public AiMemoryCleanupApplier(
      AiMemoryCleanupRepository cleanupRepo,
      AiMemoryRepository memoryRepo,
      AiPreferenceService preferences,
      AiMemoryCleanupOpApplier opApplier,
      PlatformTransactionManager txManager) {
    this.cleanupRepo = cleanupRepo;
    this.memoryRepo = memoryRepo;
    this.preferences = preferences;
    this.opApplier = opApplier;
    this.tx = new TransactionTemplate(txManager);
  }

  /** 건너뛴 세션 — 경계만 올린다. 이미 움직였으면 false. */
  public boolean markSkipped(UUID sessionId, Long processedId, long uptoId) {
    return Boolean.TRUE.equals(
        tx.execute(s -> cleanupRepo.markProcessed(sessionId, processedId, uptoId) > 0));
  }

  /**
   * 적용 — 경계를 올렸으면 true(이미 움직였으면 아무것도 하지 않고 false). 메모리를 그사이 꺼 두었으면 ops·참여자를 모두 버리고 처리 완료로 둔다.
   *
   * @param vectors 결과 문장(Op#resultText) → 질의 임베딩(없으면 정규화로만 지운 기록 판정)
   */
  public boolean apply(
      SessionCleanupInput in,
      List<Op> ops,
      Map<String, float[]> vectors,
      List<SessionCleanupParticipant.Prepared> prepared) {
    return Boolean.TRUE.equals(
        tx.execute(
            s -> {
              if (cleanupRepo.markProcessed(in.sessionId(), in.processedId(), in.uptoId()) == 0) {
                return false;
              }
              memoryRepo.lockUser(in.userId());
              if (!preferences.memoryEnabled(in.userId())) return true;
              opApplier.applyAll(in, ops, vectors);
              for (SessionCleanupParticipant.Prepared p : prepared) p.applyInTransaction();
              return true;
            }));
  }
}
