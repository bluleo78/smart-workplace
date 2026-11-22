package com.workplace.issue.service;

import com.workplace.global.ai.AgentSlotCounter;
import com.workplace.global.ai.AgentSlotLimits;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.AiAgentStatusResponse;
import com.workplace.issue.dto.AiAgentStatusResponse.AiAgentStatus;
import com.workplace.issue.dto.AiAgentStatusResponse.AiAgentWork;
import com.workplace.issue.repository.AiAgentRepository;
import com.workplace.issue.repository.AiAgentRepository.WorkRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.repository.UserRepository.ActiveAgent;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 위임 작업 「AI별」 보기(WP-1201) — 워크스페이스 AI 마다 연결 여부·열린 작업·동시 진행 자리 수를 모은다.
 *
 * <p>범위는 AI 위임 작업 목록과 같다: 전체(ALL)는 모든 AI, 나와 관련(MINE)은 내가 보고자·담당자인 이슈를 진행 중인 AI 만. 작업은 내가 볼 수 있는
 * 이슈만 싣고 나머지는 건수만 준다.
 *
 * <p>자리 수 규칙({@link #slotRows})은 AI 본인 조회에도 쓴다 — {@link AgentSlotCounter}.
 */
@Service
@RequiredArgsConstructor
public class AiAgentStatusService implements AgentSlotCounter {

  /**
   * 다시 붙는 사이의 끊김을 연결로 보는 시간 — work-loop 의 알림 구독(gw-events)은 서버 연결이 1시간마다 끝나 다시 붙고, 감시(Monitor)가
   * 30분마다 끝나면 AI 가 다시 건다. 그 틈에 「연결 끊김」이 깜빡이지 않게 한다.
   */
  static final Duration RECONNECT_GRACE = Duration.ofMinutes(3);

  /**
   * 상한에 세는 상태 — 작업 중·답변 필요·인증 필요·대기 중(다음 회차 대기·차단됨·일시 중지·검토 필요는 세지 않는다). 대기 중(PR 리뷰·기차·순서·수정·다른 AI
   * 답 대기)도 세어, PR 을 올린 뒤 머지(또는 취소)될 때까지 새 일을 가져가지 않게 한다 — 한 세션에 여러 이슈 맥락이 섞이지 않게(WP-1810, 이전
   * WP-1216 기준을 뒤집음). 다만 빼는 행은 {@link #slotRows} 참고.
   */
  private static final Set<String> SLOT_STATES =
      Set.of(
          AgentWorkState.WORKING,
          AgentWorkState.WAITING,
          AgentWorkState.INPUT_REQUIRED,
          AgentWorkState.AUTH_REQUIRED);

  private final AiAgentRepository aiAgentRepository;
  private final IssueRepository issueRepository;
  private final UserRepository userRepository;
  private final SseRegistry sseRegistry;
  private final AgentSlotLimits agentSlotLimits;

  @Transactional(readOnly = true)
  public AiAgentStatusResponse list(long callerId, String scope) {
    boolean all = "ALL".equalsIgnoreCase(scope);
    List<ActiveAgent> agents = userRepository.findActiveAgents(TenantContext.require());
    List<Long> ids = agents.stream().map(ActiveAgent::id).toList();
    Map<Long, List<WorkRow>> worksByAgent =
        aiAgentRepository
            .findLiveWorks(ids, issueRepository.memberScopeCondition(callerId), callerId)
            .stream()
            .collect(Collectors.groupingBy(WorkRow::workerId));
    Map<Long, Instant> lastEnded = aiAgentRepository.findLastEndedAt(ids);
    // AI 마다의 동시 진행 상한(WP-1754) — 한 번에 읽는다.
    Map<Long, Integer> limits = agentSlotLimits.limitsOf(ids);
    Instant now = Instant.now();

    List<AiAgentStatus> result = new ArrayList<>();
    for (ActiveAgent a : agents) {
      List<WorkRow> rows = worksByAgent.getOrDefault(a.id(), List.of());
      // 나와 관련 — 내가 볼 수 있는 내 관련 이슈를 진행 중인 AI 만.
      if (!all && rows.stream().noneMatch(r -> r.mine() && r.visible())) continue;
      result.add(toStatus(a, rows, lastEnded.get(a.id()), now, limits.get(a.id())));
    }
    // 최상위 slotLimit 은 하위 호환용 기본값(AgentSlotLimits.DEFAULT) 그대로 — 화면은 AI 별 agents[].slotLimit 을
    // 쓴다(WP-1754).
    return new AiAgentStatusResponse(result, AgentSlotLimits.DEFAULT);
  }

  /**
   * AI 본인의 자리(get_member("me"), WP-1205) — 수는 AI별 보기처럼 볼 수 없는 프로젝트 것까지 세고, 이슈 키는 그 AI 가 지금 볼 수 있는
   * 이슈만 싣는다(프로젝트에서 빠진 뒤 남은 행의 키가 요약·이슈 챗에 새지 않게).
   */
  @Override
  @Transactional(readOnly = true)
  public AgentSlots count(long agentId) {
    List<WorkRow> held =
        slotRows(
            aiAgentRepository.findLiveWorks(
                List.of(agentId), issueRepository.memberScopeCondition(agentId), agentId));
    return new AgentSlots(
        held.size(),
        agentSlotLimits.limitsOf(List.of(agentId)).get(agentId),
        held.stream().filter(WorkRow::visible).map(WorkRow::issueKey).toList());
  }

  /**
   * 동시 진행 자리를 쥔 행 — 한 AI 의 열린 작업 행 중 {@link #SLOT_STATES} 이고 무소식(stale)·반복 회차 줄 대기·선행 풀린 자리
   * 대기(WP-1956)가 아닌 것. 자리를 쥔(센) 하위가 있는 부모는 하위가 각자 세므로 뺀다. AI별 보기와 AI 본인 조회가 이 규칙 하나를 쓴다.
   */
  static List<WorkRow> slotRows(List<WorkRow> rows) {
    // 먼저 센 행을 고른 뒤, 그중 하위의 부모 id 를 모아 부모 행을 뺀다 — 무소식 하위는 자리를 쥔 게 아니므로 부모를 가리지 않는다.
    List<WorkRow> counted =
        rows.stream()
            .filter(
                r ->
                    SLOT_STATES.contains(r.state())
                        && !r.stale()
                        && !isRecurrenceQueued(r)
                        && !isSlotWaitAfterBlocker(r))
            .toList();
    Set<Long> parentsWithCountedChild =
        counted.stream()
            .map(WorkRow::parentIssueId)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());
    return counted.stream().filter(r -> !parentsWithCountedChild.contains(r.issueId())).toList();
  }

  /**
   * 반복 이슈 대기열의 줄 대기 행인가 — 반복 회차 도구({@link IssueRecurrenceService#TOOL})가 남긴, 같은 AI 의 앞 회차가 끝나기를
   * 기다리는 대기 중({@link IssueRecurrenceService#NOTE_QUEUED}). 메모만으로 가르지 않아 다른 도구의 같은 문구 보고를 잘못 빼지 않는다.
   * 서버 안 AI 가 실제로는 한 번에 하나만 돌리므로 자리로 세지 않는다 — 같은 분에 회차가 여럿 줄 서도 6/5 처럼 보이지 않게(WP-1810 리뷰 후속).
   */
  private static boolean isRecurrenceQueued(WorkRow r) {
    return AgentWorkState.WAITING.equals(r.state())
        && IssueRecurrenceService.TOOL.equals(r.tool())
        && IssueRecurrenceService.NOTE_QUEUED.equals(r.note());
  }

  /** work-loop 가 선행이 풀린 뒤 자리 나기를 기다리는 행에 남기는 note 접두어(WP-1956). */
  static final String SLOT_WAIT_NOTE_PREFIX = "선행 풀림 — 자리 대기";

  /**
   * 선행이 풀렸는데 동시 진행 자리가 차 못 고른 행인가(WP-1956) — 대기 중이고 note 가 {@link #SLOT_WAIT_NOTE_PREFIX} 로 시작한다. 이
   * 행은 자리가 나기를 기다리는 중이라 자리로 세면 스스로를 막는다(상한 1이면 영영 못 고르고 화면은 n/상한 이 부푼다) — 그래서 뺀다.
   */
  private static boolean isSlotWaitAfterBlocker(WorkRow r) {
    return AgentWorkState.WAITING.equals(r.state())
        && r.note() != null
        && r.note().startsWith(SLOT_WAIT_NOTE_PREFIX);
  }

  private AiAgentStatus toStatus(
      ActiveAgent a, List<WorkRow> rows, Instant lastEndedAt, Instant now, int slotLimit) {
    List<AiAgentWork> works = new ArrayList<>();
    int hidden = 0;
    for (WorkRow r : rows) {
      if (!r.visible()) {
        hidden++;
        continue;
      }
      works.add(
          new AiAgentWork(
              r.projectKey(),
              r.number(),
              r.title(),
              r.state(),
              r.note(),
              r.updatedAt(),
              r.stateChangedAt(),
              r.stale()));
    }
    // 연결 여부는 외부 AI 만 — 서버 안 AI(INTERNAL)는 알림 구독으로 깨어나지 않아 판단할 수 없다.
    Boolean connected = null;
    Instant disconnectedAt = null;
    if (AgentRuntime.EXTERNAL.equals(a.runtime())) {
      Instant seen = sseRegistry.lastSeen(a.id()).orElse(null);
      connected = isConnected(seen, now);
      disconnectedAt = connected ? null : seen;
    }
    return new AiAgentStatus(
        new UserSummary(a.id(), a.username(), a.name(), UserKind.AGENT),
        a.description(),
        connected,
        disconnectedAt,
        lastEndedAt,
        works,
        hidden,
        slotRows(rows).size(),
        slotLimit);
  }

  /**
   * 연결 판정 — 마지막으로 연결돼 있던 시각이 {@link #RECONNECT_GRACE} 안이면 연결로 본다(지금 연결 중이면 지금). 시각을 모르면(서버 재시작 뒤 아직
   * 안 붙음) 끊김.
   */
  static boolean isConnected(Instant lastSeen, Instant now) {
    return lastSeen != null && Duration.between(lastSeen, now).compareTo(RECONNECT_GRACE) < 0;
  }
}
