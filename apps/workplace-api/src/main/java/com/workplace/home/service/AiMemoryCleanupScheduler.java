package com.workplace.home.service;

import com.workplace.global.ai.TextEmbedder;
import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.outbound.AiAgentMemoryCleanupClient;
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
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
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
  static final int AGENT_TIMEOUT_MS = 30_000;
  static final Duration RESULT_EMBED_WAIT = Duration.ofSeconds(5);

  /** 한 회차의 시간 예산 — 시작 뒤 이만큼 지나면 새 세션을 시작하지 않고 남은 세션은 다음 회차로 넘긴다(잠금 40분 안에 끝나게). */
  static final Duration RUN_BUDGET = Duration.ofMinutes(25);

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
  private final TextEmbedder embedder;
  private final ObjectProvider<SessionCleanupParticipant> participants;
  private final TransactionTemplate tx;

  public AiMemoryCleanupScheduler(
      TenantScopedRunner tenantRunner,
      AiMemoryCleanupRepository cleanupRepo,
      AiMemoryCleanupCollector collector,
      AiMemoryCleanupApplier applier,
      AiAgentMemoryCleanupClient client,
      TextEmbedder embedder,
      ObjectProvider<SessionCleanupParticipant> participants,
      PlatformTransactionManager txManager) {
    this.tenantRunner = tenantRunner;
    this.cleanupRepo = cleanupRepo;
    this.collector = collector;
    this.applier = applier;
    this.client = client;
    this.embedder = embedder;
    this.participants = participants;
    this.tx = new TransactionTemplate(txManager);
  }

  /**
   * 5분 간격(앞 회차가 끝난 뒤부터). 첫 실행은 기동 3분 뒤 — 배포 직후 ai-agent 재기동 구간을 피한다. 잠금은 최대 40분(기본 30분보다 길게) — 회차는
   * {@link #RUN_BUDGET}(25분)이 지나면 새 세션을 시작하지 않으므로, 마지막 세션(ai-agent 30초 + 임베딩·적용)까지 끝나도 잠금 안이다.
   */
  @Scheduled(initialDelay = 180_000, fixedDelay = 300_000)
  @SchedulerLock(name = "AiMemoryCleanupScheduler.runOnce", lockAtMostFor = "PT40M")
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
    OffsetDateTime now = OffsetDateTime.ofInstant(started, ZoneOffset.UTC);
    List<Target> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId ->
            cleanupRepo
                .findTargets(now.minus(IDLE), now.minus(WINDOW), SESSIONS_PER_TENANT)
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
        Outcome o = process(t);
        if (o.calledAgent()) guard.recordResponse();
        if (o.marked()) marked++;
      } catch (MemoryCleanupAiException e) {
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

  /** 세션 하나 — 수집 → (건너뛰면 경계만) → ai-agent → 참여자 준비 → 결과 임베딩 → 적용. */
  private Outcome process(Target t) {
    Collected c = collector.collect(t.tenantId(), t.userId(), t.sessionId(), t.processedId());
    return switch (c) {
      case Nothing n -> new Outcome(false, false);
      case Skip s ->
          new Outcome(false, applier.markSkipped(t.sessionId(), t.processedId(), s.uptoId()));
      case Ready r -> run(r.input());
    };
  }

  private Outcome run(SessionCleanupInput in) {
    Result result = client.cleanup(request(in));
    List<SessionCleanupParticipant.Prepared> prepared =
        participants.orderedStream().map(p -> p.prepare(in)).toList();
    Map<String, float[]> vectors = embedResults(result.ops());
    return new Outcome(true, applier.apply(in, result.ops(), vectors, prepared));
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

  /** 수집 입력 → ai-agent 요청(비서 추천 모델, 30초). */
  static Request request(SessionCleanupInput in) {
    return new Request(
        in.spec().agentUserId(),
        in.spec().suggestionModel(),
        AGENT_TIMEOUT_MS,
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
