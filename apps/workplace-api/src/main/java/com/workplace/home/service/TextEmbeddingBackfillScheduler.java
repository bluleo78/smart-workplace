package com.workplace.home.service;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.home.service.TextEmbeddingService.Result;
import com.workplace.home.service.TextEmbeddingService.Target;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 임베딩 백필(WP-383·384) — 1분마다 활성 테넌트마다 embedding IS NULL 행을 오래된 순 50개씩(메모리 → 대화 턴 순) 채운다. 커밋 뒤 작업이 놓친
 * 행(큐 넘침·워커 장애·롤링 배포 중 구 파드의 저장)과 기존 데이터를 천천히 채운다. 빈 행 id 는 테넌트 트랜잭션에서 모으고, 임베딩·쓰기는 그 밖에서 행마다 따로
 * 한다. 워커가 연달아 실패하면 이번 주기를 멈추고 다음 주기에 다시 한다. 여러 파드는 ShedLock 으로 한 번만 돈다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TextEmbeddingBackfillScheduler {

  /** 테넌트·대상마다 한 주기에 채우는 행 수 — 워커 한 대가 1분 안에 넉넉히 끝내는 양. */
  static final int BATCH = 50;

  /**
   * 연달아 이만큼 실패하면 워커 장애로 보고 이번 주기를 멈춘다. 한 번 실패로 멈추지 않는 이유: 늘 실패하는 행 하나(워커가 거절하는 내용)가 오래된 순 맨 앞에 있으면
   * 매 주기 그 행에서 멈춰 뒤 행을 영영 못 채운다.
   */
  static final int MAX_CONSECUTIVE_FAILURES = 3;

  private final TextEmbedder embedder;
  private final TenantScopedRunner tenantRunner;
  private final TextEmbeddingRepository repo;
  private final TextEmbeddingService service;

  @Scheduled(fixedDelayString = "PT1M", initialDelayString = "PT1M")
  @SchedulerLock(name = "TextEmbeddingBackfillScheduler.backfill")
  public void backfill() {
    backfillOnce();
  }

  /** 한 주기 — 채운 행 수(테스트·수동 실행 진입점). 임베딩이 꺼져 있으면 아무것도 읽지 않는다. */
  public int backfillOnce() {
    if (!embedder.enabled()) return 0;
    Map<Long, Map<Target, List<Long>>> pending = new LinkedHashMap<>();
    tenantRunner.forEachActiveTenant(tid -> pending.put(tid, pendingOf()));
    int filled = 0;
    int failures = 0;
    for (Target target : Target.values()) {
      for (Map.Entry<Long, Map<Target, List<Long>>> e : pending.entrySet()) {
        for (long id : e.getValue().getOrDefault(target, List.of())) {
          Result r = TextEmbeddingService.inTenant(e.getKey(), () -> service.embedOne(target, id));
          if (r == Result.FAILED) {
            if (++failures >= MAX_CONSECUTIVE_FAILURES) {
              log.info("임베딩 백필 중단 — 워커 실패, 다음 주기에 다시: 채움 {}건", filled);
              return filled;
            }
            continue;
          }
          failures = 0;
          if (r == Result.FILLED) filled++;
        }
      }
    }
    if (filled > 0) log.info("임베딩 백필 — {}건", filled);
    return filled;
  }

  /** 대상마다 빈 행 id(오래된 순 BATCH 개) — 테넌트 트랜잭션 안에서 부른다. */
  private Map<Target, List<Long>> pendingOf() {
    Map<Target, List<Long>> m = new EnumMap<>(Target.class);
    m.put(Target.MEMORY, repo.pendingMemoryIds(BATCH));
    return m;
  }
}
