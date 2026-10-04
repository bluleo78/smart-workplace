package com.workplace.home.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.util.TokenEstimates;
import com.workplace.home.outbound.AiAgentContextSummaryClient;
import com.workplace.home.outbound.ChatMessages.ContextMessage;
import com.workplace.home.outbound.ChatMessages.ContextSummaryRequest;
import com.workplace.home.repository.HomeSessionRepository.SummaryState;
import com.workplace.home.service.HomeContextPolicy.Msg;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;

/**
 * 메인 AI 채팅 맥락(누적 요약 + 원문 이력) 구성·요약 갱신(WP-232).
 *
 * <ul>
 *   <li>load — 세션 요약 상태와 그 경계 이후 원문(메시지별 상한 적용)을 읽는다(요청 스레드, 현재 USER 저장 전).
 *   <li>fitToBudget — 예산 초과 시 그 턴에서 동기 요약(pump 스레드). 실패하면 오래된 원문부터 버린다.
 *   <li>scheduleIfNeeded — 턴 종료 후 trigger 초과면 전용 executor 로 비동기 요약 예약(세션당 1건).
 * </ul>
 *
 * 요약 저장은 조건부 갱신이라 동기·비동기 요약이 겹쳐도 늦게 끝난 쪽은 버려진다. 요약이 실패하면 세션별로 잠시(FAILURE_COOLDOWN) 요약을 쉬어, ai-agent
 * 장애 중 매 턴 진행 라벨 + 긴 블록을 반복하지 않는다.
 */
@Slf4j
@Service
public class HomeContextSummaryService {

  /** 요약 실행 예산 — 도구 없는 단발 요약. 클라이언트 read 90s 이내. */
  static final int SUMMARY_MAX_TURNS = 3;

  static final int SUMMARY_TIMEOUT_MS = 60_000;

  /**
   * 요약 실패 후 같은 세션의 요약 재시도를 쉬는 시간. ai-agent 가 내려가 있으면 매 예산 초과 턴마다 동기 요약(진행 라벨 + 최대 read 90s 블록)이 반복돼
   * 채팅이 매번 느려지므로, 그동안은 요약 없이 오래된 원문을 버리는 폴백으로 바로 진행한다.
   */
  static final Duration FAILURE_COOLDOWN = Duration.ofMinutes(5);

  /**
   * 한 번의 요약 실행(compact)에서 접는 최대 청크 수. 동기 요약은 채팅 턴을 막고 서므로(청크당 요약 호출 1회) 지연 상한을 두고, 남은 분량은 다음 트리거(턴
   * 종료 비동기 요약)에서 이어 접는다.
   */
  static final int MAX_CHUNKS_PER_COMPACTION = 3;

  private final HomeSessionService sessionService;
  private final AiAgentContextSummaryClient summaryClient;
  private final AssistantResolver assistantResolver;
  private final HomeChatProperties props;
  private final AsyncTaskExecutor executor;

  /** 비동기 요약 진행 중인 세션 — 같은 세션 중복 예약 방지(단일 인스턴스 가정, 중복돼도 조건부 갱신이 막는다). */
  private final Set<UUID> inFlight = ConcurrentHashMap.newKeySet();

  /** 요약 실패 쿨다운 종료 시각(세션별, 인메모리 — 재기동 시 초기화돼도 다시 한 번 시도할 뿐이라 무해). */
  private final Map<UUID, Instant> failedUntil = new ConcurrentHashMap<>();

  public HomeContextSummaryService(
      HomeSessionService sessionService,
      AiAgentContextSummaryClient summaryClient,
      AssistantResolver assistantResolver,
      HomeChatProperties props,
      @Qualifier("homeContextSummaryExecutor") AsyncTaskExecutor executor) {
    this.sessionService = sessionService;
    this.summaryClient = summaryClient;
    this.assistantResolver = assistantResolver;
    this.props = props;
    this.executor = executor;
  }

  /** 한 턴의 맥락 스냅샷 — summary/uptoId 는 세션 저장값, raw 는 경계 이후 원문(오래된 순). */
  public record ContextSnapshot(String summary, Long uptoId, List<Msg> raw) {
    /** ai-agent 요청용 원문 이력. */
    public List<ContextMessage> toContext() {
      return toContextMessages(raw);
    }
  }

  /** Msg → ai-agent ContextMessage 변환(채팅 요청 이력·요약 요청 구간 공용). */
  private static List<ContextMessage> toContextMessages(List<Msg> msgs) {
    return msgs.stream().map(m -> new ContextMessage(m.role(), m.content())).toList();
  }

  /**
   * 세션 요약 상태와 경계 이후 원문을 읽는다. 메시지별 상한을 넘는 본문은 잘라 둔다. 경계 이후 id·role·content 만 한 번에 읽어(전체 메시지 JSON 파싱
   * 없음) 매 턴 시작·턴 종료 예약 판단 비용을 줄인다.
   */
  public ContextSnapshot load(long callerId, UUID sessionId) {
    HomeSessionService.ContextSource src = sessionService.getContextSource(callerId, sessionId);
    SummaryState state = src.state();
    List<Msg> raw =
        src.rows().stream()
            .map(
                r ->
                    HomeContextPolicy.capContent(
                        new Msg(r.id(), r.role(), r.content()), props.perMessageCap()))
            .toList();
    return new ContextSnapshot(state.summary(), state.uptoMessageId(), raw);
  }

  /**
   * 하드 상한(예산) 이내면 그대로, 넘으면 동기 요약(onCompacting 으로 진행 표시 후). 요약이 실패하면 오래된 원문부터 버려 예산에 맞춘다 — 채팅은 계속
   * 진행.
   *
   * <p>단, 요약 중 사용자 취소(인터럽트)면 폴백하지 않고 예외를 그대로 던진다(HomeChatService 가 cancelled 로 처리).
   */
  public ContextSnapshot fitToBudget(
      long callerId,
      UUID sessionId,
      ContextSnapshot snap,
      AssistantSpec spec,
      Runnable onCompacting) {
    int budget = props.contextTokenBudget();
    if (HomeContextPolicy.total(snap.summary(), snap.raw()) <= budget) return snap;
    // 최근 요약 실패 쿨다운 중이면 요약을 시도하지 않고(진행 라벨도 없이) 바로 폴백한다.
    if (coolingDown(sessionId)) return dropOldestToFit(snap, budget);
    onCompacting.run();
    try {
      ContextSnapshot compacted = compact(callerId, sessionId, snap, spec);
      // 청크 상한에 걸려 아직 예산을 넘으면 이번 턴만 오래된 원문을 버려 맞춘다(저장하지 않음 — 다음 트리거에서 이어 접는다).
      return HomeContextPolicy.total(compacted.summary(), compacted.raw()) <= budget
          ? compacted
          : dropOldestToFit(compacted, budget);
    } catch (RuntimeException e) {
      // 사용자 취소(registry.cancel → 펌프 인터럽트)는 요약 실패가 아니다 — 폴백으로 compose 를 이어가면 취소된 턴이 도구 부작용·
      // ASSISTANT 영속까지 진행된다. 인터럽트 플래그를 복원하고 그대로 던져 HomeChatService 가 cancelled 신호를 내게 한다(요약
      // read 타임아웃은 취소가 아니라 실패 — 아래 폴백).
      if (HomeInterruptions.isUserCancel(e)) {
        Thread.currentThread().interrupt();
        throw e;
      }
      log.warn("홈 채팅 동기 요약 실패 — 오래된 원문을 버려 예산에 맞춤: session={} {}", sessionId, e.getMessage());
      recordFailure(sessionId);
      return dropOldestToFit(snap, budget);
    }
  }

  /** 요약 없이 오래된 원문부터 버려 예산에 맞춘 스냅샷(요약 실패·쿨다운 폴백). */
  private static ContextSnapshot dropOldestToFit(ContextSnapshot snap, int budget) {
    return new ContextSnapshot(
        snap.summary(),
        snap.uptoId(),
        HomeContextPolicy.dropOldestToFit(snap.summary(), snap.raw(), budget));
  }

  /** 세션이 요약 실패 쿨다운 중인지. 만료된 항목은 이때 지운다. */
  private boolean coolingDown(UUID sessionId) {
    Instant until = failedUntil.get(sessionId);
    if (until == null) return false;
    if (Instant.now().isBefore(until)) return true;
    failedUntil.remove(sessionId, until);
    return false;
  }

  /** 요약 실패 기록 — 쿨다운 시작. 다시 오지 않는 세션 항목이 쌓이지 않게 만료분을 함께 정리한다(실패 시에만 도는 O(n)). */
  private void recordFailure(UUID sessionId) {
    Instant now = Instant.now();
    failedUntil.values().removeIf(until -> !now.isBefore(until));
    failedUntil.put(sessionId, now.plus(FAILURE_COOLDOWN));
  }

  /**
   * 턴 종료 후 호출 — 요약 + 원문이 trigger 를 넘으면 비동기 요약을 예약한다. 예외를 던지지 않는다(채팅 done 처리에 영향 X). 실패하면
   * 쿨다운(FAILURE_COOLDOWN) 이 지난 뒤의 턴 종료 시 다시 시도된다.
   */
  public void scheduleIfNeeded(long callerId, UUID sessionId) {
    // 요약 실패 쿨다운 중이면 예약하지 않는다(장애 중 매 턴 헛된 요약 호출 방지).
    if (coolingDown(sessionId)) return;
    try {
      ContextSnapshot snap = load(callerId, sessionId);
      if (HomeContextPolicy.total(snap.summary(), snap.raw()) <= props.summarizeTrigger()) return;
      if (!inFlight.add(sessionId)) return;
      try {
        executor.execute(() -> runAsync(callerId, sessionId));
      } catch (TaskRejectedException e) {
        inFlight.remove(sessionId);
        log.warn("홈 채팅 요약 예약 거부(큐 포화) — 다음 턴에 재시도: session={}", sessionId);
      }
    } catch (RuntimeException e) {
      log.warn("홈 채팅 요약 예약 판단 실패: session={} {}", sessionId, e.getMessage());
    }
  }

  /** 비동기 요약 본체 — 최신 상태를 다시 읽어 압축한다. */
  private void runAsync(long callerId, UUID sessionId) {
    try {
      compact(callerId, sessionId, load(callerId, sessionId), assistantResolver.resolve(callerId));
    } catch (RuntimeException e) {
      log.warn("홈 채팅 비동기 요약 실패(쿨다운 후 재시도): session={} {}", sessionId, e.getMessage());
      recordFailure(sessionId);
    } finally {
      inFlight.remove(sessionId);
    }
  }

  /**
   * 원문을 target 까지 남기고 앞부분을 기존 요약에 접어 저장한 뒤, 이번 턴에 쓸 새 스냅샷을 돌려준다. 접을 구간은 오래된 순 청크(누적 비용 ≤ target)로
   * 나눠 청크마다 요약·조건부 저장하고 새 상태에서 이어간다 — 경계 없는 장기 세션도 요약 요청 크기가 제한돼 실패가 고착되지 않는다. 남은 원문이 target 경계 안에
   * 들거나 MAX_CHUNKS_PER_COMPACTION 청크를 접으면 멈춘다. 조건부 저장에서 지면(다른 요약이 먼저 경계를 옮김) 루프를 멈추고 이번 턴은 방금 만든
   * 요약으로 진행한다. 중간 청크가 실패하면 이미 저장된 청크는 그대로 두고 예외를 던진다(호출부의 실패 처리).
   */
  private ContextSnapshot compact(
      long callerId, UUID sessionId, ContextSnapshot snap, AssistantSpec spec) {
    int target = props.summarizeTarget();
    ContextSnapshot cur = snap;
    for (int n = 0; n < MAX_CHUNKS_PER_COMPACTION; n++) {
      List<Msg> raw = cur.raw();
      int b = HomeContextPolicy.boundary(raw, target);
      if (b == 0) break;
      int end = HomeContextPolicy.chunkEnd(raw, b, target);
      List<Msg> fold = raw.subList(0, end);
      String summary =
          summaryClient
              .summarize(
                  new ContextSummaryRequest(
                      spec.agentUserId(),
                      spec.model(),
                      SUMMARY_MAX_TURNS,
                      SUMMARY_TIMEOUT_MS,
                      cur.summary(),
                      toContextMessages(fold)))
              .summary();
      // 요약 호출 성공 — 쿨다운 해제(저장 경합에 져도 ai-agent 는 정상이므로).
      failedUntil.remove(sessionId);
      String capped = TokenEstimates.truncate(summary, props.perMessageCap());
      long newUpto = fold.get(end - 1).id();
      ContextSnapshot next = new ContextSnapshot(capped, newUpto, raw.subList(end, raw.size()));
      if (sessionService.saveContextSummary(callerId, sessionId, cur.uptoId(), capped, newUpto)
          == 0) {
        log.debug("홈 채팅 요약 저장 경합 패배 — 이후 청크 중단: session={}", sessionId);
        return next;
      }
      cur = next;
    }
    return cur;
  }
}
