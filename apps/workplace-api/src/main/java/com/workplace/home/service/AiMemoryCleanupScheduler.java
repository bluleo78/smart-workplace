package com.workplace.home.service;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.RoundDeadline;
import com.workplace.auth.service.AssistantLimitGuard;
import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.outbound.AiAgentMemoryCleanupClient;
import com.workplace.home.outbound.HomeChatConfig;
import com.workplace.home.outbound.MemoryCleanupMessages;
import com.workplace.home.outbound.MemoryCleanupMessages.MemoryRef;
import com.workplace.home.outbound.MemoryCleanupMessages.Op;
import com.workplace.home.outbound.MemoryCleanupMessages.Request;
import com.workplace.home.outbound.MemoryCleanupMessages.Result;
import com.workplace.home.repository.AiMemoryCleanupRepository;
import com.workplace.home.service.AiMemoryCleanupCollector.Collected;
import com.workplace.home.service.AiMemoryCleanupCollector.Nothing;
import com.workplace.home.service.AiMemoryCleanupCollector.Ready;
import com.workplace.home.service.AiMemoryCleanupCollector.Skip;
import com.workplace.home.service.SessionCleanupParticipant.DeadlineReached;
import com.workplace.home.service.SessionCleanupParticipant.SpaceBudget;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 대화가 끝난 뒤 AI 메모리 배경 정리(WP-385 스펙 5) — 5분마다(ShedLock) 활성 테넌트마다 마지막 메시지가 30분~7일 전이고 경계 뒤 메시지가 있는 세션을
 * 오래된 순 20개씩 모아, 세션마다 수집(짧은 트랜잭션) → ai-agent 정리 호출(트랜잭션 밖) → 결과 임베딩(트랜잭션 밖) → 적용·기록·경계 갱신(짧은 트랜잭션)
 * 한다(우선순위 분류와 같은 3단).
 *
 * <p>실패: ai-agent 연결 실패·503 은 세지 않고 {@link AgentOutageGuard} 로 연속 3회면 회차를 멈춘다. 그 밖의 실패(502·4xx·읽기
 * 시간 초과·DB 오류)는 세션의 memory_cleanup_failures 를 올리고 3회째에 처리 완료로 표시한다(무한 재시도 방지). 실패한 세션의 경계는 그대로라 다음
 * 회차에 다시 한다.
 */
@Slf4j
@Component
public class AiMemoryCleanupScheduler {

  static final Duration IDLE = Duration.ofMinutes(30);
  static final Duration WINDOW = Duration.ofDays(7);
  static final int SESSIONS_PER_TENANT = 20;
  static final int MAX_FAILURES = 3;
  static final Duration RESULT_EMBED_WAIT = Duration.ofSeconds(5);

  /**
   * 정리 결과 op 상한 — ai-agent run-memory-cleanup.ts 의 출력 스키마(ops .max(30))와 같은 값. 결과 임베딩 최악(이 수 ×
   * {@link #RESULT_EMBED_WAIT})을 정리 호출 전 마감 확인에 더한다(WP-2111 리뷰 후속 1).
   */
  static final int CLEANUP_MAX_OPS = 30;

  /**
   * 새 세션 시작 마감 — 시작 뒤 이만큼 지나면 새 세션을 시작하지 않고 남은 세션은 다음 회차로 넘긴다. 세션 안의 공용 추출은 공간 수에 상한이 없어 이것만으로는 잠금을
   * 지키지 못하므로, 공간마다 {@link #LOCK_AT_MOST} − 2분 마감도 확인한다(WP-2111, {@link SpaceBudget}).
   */
  static final Duration RUN_BUDGET = Duration.ofMinutes(20);

  /** 잠금 최대 — @SchedulerLock 의 lockAtMostFor 와 회차 마감 계산이 함께 쓰는 한 값. */
  static final String LOCK_AT_MOST_FOR = "PT40M";

  /** 잠금 최대 Duration — {@link #LOCK_AT_MOST_FOR} 를 파싱한 값. */
  static final Duration LOCK_AT_MOST = Duration.parse(LOCK_AT_MOST_FOR);

  /**
   * 내용을 새로 만드는 op — 결과 문장을 임베딩해 지운 기록과 비교한다. WP-386 공용 추출(SharedMemoryExtractionParticipant)도 같은
   * 정의를 쓴다.
   */
  static final Set<String> CONTENT_OPS = Set.of("ADD", "UPDATE", "MERGE");

  private record Target(long tenantId, long userId, UUID sessionId, Long processedId) {}

  /** 세션 하나의 결과 — ai-agent 를 실제로 불렀는가(장애 판정 근거), 경계를 올렸는가. */
  private record Outcome(boolean calledAgent, boolean marked) {}

  private final TenantScopedRunner tenantRunner;
  private final AiMemoryCleanupRepository cleanupRepo;
  private final AiMemoryCleanupCollector collector;
  private final AiMemoryCleanupApplier applier;
  private final AiAgentMemoryCleanupClient client;
  private final AssistantLimitGuard limitGuard;
  private final TextEmbedder embedder;
  private final ObjectProvider<SessionCleanupParticipant> participants;
  private final TransactionTemplate tx;

  /** AI 호출 실행 상한 표(WP-2111). */
  private final AiCallTimeouts timeouts;

  /**
   * 정리 호출 하나의 최악 — 정리 클라이언트의 읽기 상한(덮어쓴 값 반영) + 결과 임베딩 최악(op 상한 × 5초). 정리 호출 전 마감 확인에 쓴다(WP-2111 리뷰
   * 후속 1 — 임베딩을 빼면 확인을 지나도 임베딩 뒤 첫 공간에서 걸려 끝난 정리 호출을 버릴 수 있다).
   */
  private final Duration cleanupWorst;

  public AiMemoryCleanupScheduler(
      TenantScopedRunner tenantRunner,
      AiMemoryCleanupRepository cleanupRepo,
      AiMemoryCleanupCollector collector,
      AiMemoryCleanupApplier applier,
      AiAgentMemoryCleanupClient client,
      AssistantLimitGuard limitGuard,
      TextEmbedder embedder,
      ObjectProvider<SessionCleanupParticipant> participants,
      PlatformTransactionManager txManager,
      AiCallTimeouts timeouts) {
    this.timeouts = timeouts;
    this.cleanupWorst =
        HomeChatConfig.memoryCleanupReadTimeout(timeouts)
            .plus(RESULT_EMBED_WAIT.multipliedBy(CLEANUP_MAX_OPS));
    this.tenantRunner = tenantRunner;
    this.cleanupRepo = cleanupRepo;
    this.collector = collector;
    this.applier = applier;
    this.client = client;
    this.limitGuard = limitGuard;
    this.embedder = embedder;
    this.participants = participants;
    this.tx = new TransactionTemplate(txManager);
  }

  /**
   * 5분 간격(앞 회차가 끝난 뒤부터). 첫 실행은 기동 3분 뒤 — 배포 직후 ai-agent 재기동 구간을 피한다. 잠금은 최대 40분(기본 30분보다 길게).
   *
   * <p>잠금 계산(WP-2111): 새 세션은 {@link #RUN_BUDGET}(20분) 안에서만 시작한다. 회차의 첫 세션이 아니면 정리 호출을 부르기 <b>전에</b>
   * 「지금 + 정리 최악(정리 읽기 상한 = 실행 상한 기본 60초 + 여유 30초 = 90초, + 결과 임베딩 30×5초) + 그 세션의 공간 하나 최악(공간 발화가 없으면
   * 0)」이 회차 마감을 넘는지 보고, 넘으면 부르지 않고 미룬다 — 부른 뒤 첫 공간에서 걸려 끝난 호출을 버리지 않게(리뷰 후속). 세션 안의 공용 추출은 공간마다 시작
   * 전에 「지금 + 공간 최악(추출 90초 + 검사 2×90초 + 임베딩 20×5초 = 370초)」이 회차 마감(잠금 40분 − 2분 = 38분)을 넘는지 본다(추출·검사
   * 최악은 배경 클라이언트 읽기 상한). 넘으면 그 세션은 다음 회차로 미루고(실패로 세지 않음) 회차를 멈춘다 — 회차의 첫 세션만은 미루지 않고 처리한 공간까지만 진행한
   * 것으로 기록한다: 경계를 건너뛴 첫 공간의 첫 발화 바로 앞까지만 올려 다음 회차가 남은 공간부터 이어 한다(건너뛴 발화를 잃지 않고, 회차마다 적어도 한 공간씩
   * 나아간다). 그래서 마지막 공간이 끝나는 시각 ≤ 38분이고, 남는 2분이 적용 트랜잭션 몫이다.
   */
  @Scheduled(initialDelay = 180_000, fixedDelay = 300_000)
  @SchedulerLock(name = "AiMemoryCleanupScheduler.runOnce", lockAtMostFor = LOCK_AT_MOST_FOR)
  public void runOnce() {
    runAllTenants();
  }

  /** 한 회차 — 경계를 올린(처리 완료로 표시한) 세션 수. 테스트·수동 실행 진입점. */
  public int runAllTenants() {
    return runAllTenants(Clock.systemUTC());
  }

  /** 한 회차(시계 주입 — 테스트가 시간 예산을 결정적으로 넘긴다). */
  int runAllTenants(Clock clock) {
    Instant started = clock.instant();
    Instant deadline = started.plus(RUN_BUDGET);
    RoundDeadline lockDeadline = RoundDeadline.underLock(clock, LOCK_AT_MOST);
    // 이번 회차에 이미 ai-agent 를 부른 세션이 있는가 — 없으면(첫 세션) 공간 마감에 걸려도 미루지 않고 처리한 공간까지만 기록한다(SpaceBudget 참고).
    boolean agentCalled = false;
    OffsetDateTime now = OffsetDateTime.ofInstant(started, ZoneOffset.UTC);
    List<Target> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId ->
            selectTargets(now)
                .forEach(
                    t ->
                        targets.add(
                            new Target(tenantId, t.userId(), t.sessionId(), t.processedId()))));
    AgentOutageGuard guard = new AgentOutageGuard();
    int marked = 0;
    for (int i = 0; i < targets.size(); i++) {
      Target t = targets.get(i);
      if (guard.tripped()) {
        log.warn(
            "ai-agent 불가 {}회 연속 — 이번 메모리 정리 회차 중단", AgentOutageGuard.MAX_CONSECUTIVE_UNAVAILABLE);
        break;
      }
      // 시간 예산을 넘겼으면 새 세션을 시작하지 않는다 — 남은 세션은 경계가 그대로라 다음 회차가 이어 한다(실패로 세지 않는다).
      if (!clock.instant().isBefore(deadline)) {
        log.warn(
            "메모리 정리 회차가 {}분을 넘김 — 남은 {}개 세션은 다음 회차에", RUN_BUDGET.toMinutes(), targets.size() - i);
        break;
      }
      TenantContext.set(t.tenantId());
      try {
        Outcome o = process(t, new SpaceBudget(lockDeadline, agentCalled));
        if (o.calledAgent()) {
          guard.recordResponse();
          agentCalled = true;
        }
        if (o.marked()) marked++;
      } catch (DeadlineReached e) {
        // 공간 마감 — 경계를 그대로 두어 다음 회차가 이 세션부터 다시 한다(실패로 세지 않는다).
        log.warn("메모리 정리 회차 마감 — 세션 {}과 남은 {}개 세션은 다음 회차에", t.sessionId(), targets.size() - i - 1);
        break;
      } catch (MemoryCleanupAiException e) {
        agentCalled = true;
        boolean down = e.isAgentDown();
        if (down) guard.recordUnavailable();
        else guard.recordResponse();
        // 연결 실패·503 은 그 세션 탓이 아니다 — 세지 않고 다음 회차에 다시 한다. 읽기 시간 초과는 그 세션만의 실패로도 센다.
        if (!down || e.isReadTimeout()) countFailure(t, e);
        else
          log.warn(
              "메모리 정리 ai-agent 불가 — 다음 회차에 다시: tenant={} session={} {}",
              t.tenantId(),
              t.sessionId(),
              AgentOutageGuard.describe(e));
      } catch (RuntimeException e) {
        countFailure(t, e);
      } finally {
        TenantContext.clear();
      }
    }
    return marked;
  }

  /**
   * 현재 테넌트의 대상 세션(최대 {@link #SESSIONS_PER_TENANT}). 한도 대기 중인 사용자의 세션은 경계를 올리지 않아 매 회차 같은 오래된 세션으로
   * 다시 뽑히므로, 그대로 두면 슬롯 20개를 다 차지해 대기 아닌 사용자가 굶는다(WP-2108). 그래서 대기 중으로 드러난 사용자는 제외하고 다시 뽑아 슬롯을 채운다 —
   * 한 번 돌 때마다 제외 사용자가 늘어 끝난다.
   */
  private List<AiMemoryCleanupRepository.Target> selectTargets(OffsetDateTime now) {
    Set<Long> waiting = new HashSet<>();
    Set<Long> ready = new HashSet<>();
    while (true) {
      List<AiMemoryCleanupRepository.Target> found =
          cleanupRepo.findTargets(now.minus(IDLE), now.minus(WINDOW), SESSIONS_PER_TENANT, waiting);
      boolean grew = false;
      for (var t : found) {
        long uid = t.userId();
        if (waiting.contains(uid) || ready.contains(uid)) continue;
        if (collector.isWaiting(uid)) {
          waiting.add(uid);
          grew = true;
        } else {
          ready.add(uid);
        }
      }
      if (!grew) return found;
    }
  }

  /** 세션 하나 — 수집 → (건너뛰면 경계만) → ai-agent → 참여자 준비 → 결과 임베딩 → 적용. */
  private Outcome process(Target t, SpaceBudget budget) {
    Collected c = collector.collect(t.tenantId(), t.userId(), t.sessionId(), t.processedId());
    return switch (c) {
      case Nothing n -> new Outcome(false, false);
      case Skip s ->
          new Outcome(false, applier.markSkipped(t.sessionId(), t.processedId(), s.uptoId()));
      case Ready r -> run(r.input(), budget);
    };
  }

  /**
   * 정리 호출 → 결과 임베딩 → 참여자 준비(공간 마감 확인) → 적용. 임베딩을 참여자 준비보다 먼저 해, 공간 마감 확인 뒤에는 적용만 남게 한다(WP-2111).
   */
  private Outcome run(SessionCleanupInput in, SpaceBudget budget) {
    // 미루는 예산(회차 첫 세션이 아님)이면 정리 호출 전에 「정리 최악 + 참여자 단위 하나 최악」이 마감 안인지 본다 — 호출 뒤 첫 공간에서 걸려 미루면
    // 끝난 정리 호출·임베딩을 버리고 다음 회차에 되풀이한다(WP-2111 리뷰 후속). 첫 세션은 미루지 않으므로 보지 않는다(참여자가 처리한 데까지만 기록).
    if (budget.deferOnOverrun()
        && !budget.deadline().allows(cleanupWorst.plus(participantUnitWorst(in)))) {
      throw new DeadlineReached("메모리 정리 — 회차 마감 전에 정리 호출과 공간 하나를 끝낼 수 없음");
    }
    // 한도로 실패하면 그 자격을 대기로 건다(WP-2108) — 실패 처리는 그대로(같은 예외가 올라간다).
    Result result = limitGuard.call(in.spec(), () -> client.cleanup(request(in)));
    Map<String, float[]> vectors = embedResults(result.ops());
    List<SessionCleanupParticipant.Prepared> prepared =
        participants.orderedStream().map(p -> p.prepare(in, budget)).toList();
    return new Outcome(true, applier.apply(in, result.ops(), vectors, prepared));
  }

  /** 이 입력에 대한 참여자 처리 단위 하나의 최악 중 가장 큰 값(일이 없거나 모르면 0). */
  private Duration participantUnitWorst(SessionCleanupInput in) {
    return participants
        .orderedStream()
        .map(p -> p.unitWorst(in))
        .filter(java.util.Objects::nonNull)
        .max(Duration::compareTo)
        .orElse(Duration.ZERO);
  }

  /**
   * ADD·UPDATE·MERGE 결과 문장의 질의 임베딩(트랜잭션 밖, 문장마다 5초) — 실패한 문장은 맵에 없다(정규화로만 판정). null op·이름 없는 op 은
   * Result 가 이미 걸렀다.
   */
  private Map<String, float[]> embedResults(List<Op> ops) {
    Map<String, float[]> out = new HashMap<>();
    for (Op op : ops) {
      String text = op.resultText();
      if (!CONTENT_OPS.contains(op.op())
          || text == null
          || text.isEmpty()
          || out.containsKey(text)) {
        continue;
      }
      embedder.embedQuery(text, RESULT_EMBED_WAIT).ifPresent(v -> out.put(text, v));
    }
    return out;
  }

  /** 실패 1회를 센다 — 3회째면 경계를 지금 마지막 메시지로 올리고 경고(무한 재시도 방지). 세기 자체의 실패는 로그만. */
  private void countFailure(Target t, RuntimeException e) {
    try {
      Integer n = tx.execute(s -> cleanupRepo.recordFailure(t.sessionId()));
      if (n != null && n >= MAX_FAILURES) {
        tx.executeWithoutResult(s -> cleanupRepo.markProcessedToLatest(t.sessionId()));
        log.warn(
            "메모리 정리 {}회 연속 실패 — 처리한 것으로 표시: tenant={} session={} {}",
            n,
            t.tenantId(),
            t.sessionId(),
            AgentOutageGuard.describe(e));
      } else {
        log.warn(
            "메모리 정리 실패({}회) — 다음 회차에 다시: tenant={} session={} {}",
            n,
            t.tenantId(),
            t.sessionId(),
            AgentOutageGuard.describe(e));
      }
    } catch (RuntimeException ex) {
      log.warn("메모리 정리 실패 횟수 기록 실패: session={} {}", t.sessionId(), ex.getMessage());
    }
  }

  /** 수집 입력 → ai-agent 요청(비서 추천 모델, 실행 상한은 표의 HOME_MEMORY_CLEANUP). */
  Request request(SessionCleanupInput in) {
    return new Request(
        in.spec().agentUserId(),
        in.spec().suggestionModel(),
        timeouts.timeoutMs(AiCall.HOME_MEMORY_CLEANUP),
        in.today().toString(),
        in.utterances().stream().map(SessionCleanupInput.Utterance::text).toList(),
        in.assistantNotes().stream()
            .map(n -> new MemoryCleanupMessages.AssistantNote(n.after(), n.text()))
            .toList(),
        in.memories().stream()
            .map(
                r ->
                    new MemoryRef(
                        r.id(),
                        r.kind(),
                        r.content(),
                        r.scope(),
                        r.expiresOn() == null ? null : r.expiresOn().toString(),
                        r.source(),
                        r.pinned(),
                        in.protectedIds().contains(r.id())))
            .toList());
  }
}
