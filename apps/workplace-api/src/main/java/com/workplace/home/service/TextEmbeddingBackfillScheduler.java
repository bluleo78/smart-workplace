package com.workplace.home.service;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.repository.TextEmbeddingRepository;
import com.workplace.home.service.TextEmbeddingService.Result;
import com.workplace.home.service.TextEmbeddingService.Target;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 임베딩 백필(WP-383·384) — 1분마다 활성 테넌트마다 embedding IS NULL 행을 오래된 순 50개씩(메모리 → 대화 턴 → 지운 기록 순) 채운다. 커밋
 * 뒤 작업이 놓친 행(큐 넘침·워커 장애·롤링 배포 중 구 파드의 저장)과 기존 데이터를 천천히 채운다. 빈 행 id 는 테넌트 트랜잭션에서 모으고, 임베딩·쓰기는 그 밖에서
 * 행마다 따로 한다. 워커가 연달아 실패하면 이번 주기를 멈추고 다음 주기에 다시 한다 — 실패한 행은 다음 주기 맨 끝으로 미뤄 늘 실패하는 행이 다른 행을 막지 않는다.
 * 여러 파드는 ShedLock 으로 한 번만 돈다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TextEmbeddingBackfillScheduler {

  /** 테넌트·대상마다 한 주기에 채우는 행 수 — 워커 한 대가 1분 안에 넉넉히 끝내는 양. */
  static final int BATCH = 50;

  /**
   * 연달아 이만큼 실패하면 워커 장애로 보고 이번 주기를 멈춘다 — 워커가 죽었을 때 주기마다 헛 호출을 이 수로 묶는다. 늘 실패하는 행(워커가 거절하는 내용)이 오래된 순
   * 맨 앞에 이만큼 몰려 있어도 막히지 않는 이유는 recentlyFailed — 실패한 행은 다음 주기에 맨 끝으로 미뤄진다.
   */
  static final int MAX_CONSECUTIVE_FAILURES = 3;

  /** 백필 한 건 — 테넌트·대상·행 id. */
  private record Job(long tenantId, Target target, long id) {}

  /**
   * 지난 주기들에서 실패한 행. 다음 주기에는 다른 빈 행을 모두 먼저 해 보고 이 행들은 맨 끝에 다시 해 본다(영영 건너뛰지 않는다 — 워커 장애로 실패한 행도 회복 뒤
   * 채워진다). 성공하면 빼고, 이번 주기 빈 행 목록에 없는 키(다른 경로로 채워졌거나 지워진 행)는 버려 크기가 빈 행 수(테넌트 × 대상 × BATCH)를 넘지 않는다.
   * 파드마다 따로 든다 — 다른 파드가 주기를 잡으면 그 파드는 처음 한 번 다시 멈췄다가 배운다.
   */
  private final Set<Job> recentlyFailed = ConcurrentHashMap.newKeySet();

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
    List<Job> jobs = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tid -> pendingOf().forEach((t, ids) -> ids.forEach(id -> jobs.add(new Job(tid, t, id)))));
    // 메모리 먼저(스펙 3.2) — 테넌트별로 쌓인 순서를 대상 기준 안정 정렬해, 연속 실패로 주기가 멈춰도 뒤 테넌트의 메모리가 앞 테넌트의 턴 뒤에서 기다리지 않는다.
    jobs.sort(Comparator.comparing(Job::target));
    recentlyFailed.retainAll(new HashSet<>(jobs));
    // 지난번에 실패한 행은 맨 끝으로 — 늘 실패하는 행이 앞에 몰려 있어도 다른 행(다른 테넌트 포함)이 먼저 채워진다.
    List<Job> ordered = new ArrayList<>(jobs.size());
    jobs.stream().filter(j -> !recentlyFailed.contains(j)).forEach(ordered::add);
    jobs.stream().filter(recentlyFailed::contains).forEach(ordered::add);
    int filled = 0;
    int failures = 0;
    for (Job j : ordered) {
      Result r =
          TextEmbeddingService.inTenant(j.tenantId(), () -> service.embedOne(j.target(), j.id()));
      if (r == Result.FAILED) {
        recentlyFailed.add(j);
        if (++failures >= MAX_CONSECUTIVE_FAILURES) {
          log.info("임베딩 백필 중단 — 워커 실패, 다음 주기에 다시: 채움 {}건", filled);
          return filled;
        }
        continue;
      }
      recentlyFailed.remove(j);
      failures = 0;
      if (r == Result.FILLED) filled++;
    }
    if (filled > 0) log.info("임베딩 백필 — {}건", filled);
    return filled;
  }

  /** 대상마다 빈 행 id(오래된 순 BATCH 개) — 테넌트 트랜잭션 안에서 부른다. */
  private Map<Target, List<Long>> pendingOf() {
    Map<Target, List<Long>> m = new EnumMap<>(Target.class);
    m.put(Target.MEMORY, repo.pendingMemoryIds(BATCH));
    m.put(Target.TURN, repo.pendingTurnIds(BATCH));
    m.put(Target.FORGOTTEN, repo.pendingForgottenIds(BATCH));
    m.put(Target.SHARED_MEMORY, repo.pendingSharedMemoryIds(BATCH));
    m.put(Target.SHARED_FORGOTTEN, repo.pendingSharedForgottenIds(BATCH));
    return m;
  }
}
