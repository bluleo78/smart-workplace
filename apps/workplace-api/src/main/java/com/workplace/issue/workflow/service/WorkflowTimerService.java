package com.workplace.issue.workflow.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowTurnEscalate;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowTurnRemind;
import com.workplace.issue.workflow.domain.NodeTypes;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.repository.NodeRunRow;
import com.workplace.issue.workflow.repository.RunEventRow;
import com.workplace.issue.workflow.repository.RunRow;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * 기다림 타이머(WP-1987) — 사람·AI 가 머무는 노드 방문이 오래 기다리면 담당에게 다시 알리고(remind), 그래도 머물면 프로젝트 관리자에게
 * 알린다(escalate).
 *
 * <p>알림만 한다: node_run·workflow_run 의 상태·현재 노드·revision 은 절대 바꾸지 않는다. 방문(nodeRunId)마다
 * TIMER_REMIND·TIMER_ESCALATE 이벤트를 각각 최대 한 번만 남겨 중복 알림을 막는다.
 *
 * <p>트랜잭션은 부르는 쪽(테넌트 러너)이 연다 — 그래서 {@code @Transactional} 이 없다. 방문 하나가 실패해도 그 방문의 세이브포인트만 되돌리고 로그를
 * 남기며 다음 방문으로 간다.
 */
@Slf4j
@Component
public class WorkflowTimerService {

  /** timeout 이 없는 human_task 의 기본 기간 — 되돌림 답변 노드(returnTo)는 하루, 그 밖은 이틀. */
  private static final Duration DEFAULT_ANSWER = Duration.ofDays(1);

  private static final Duration DEFAULT_TASK = Duration.ofDays(2);

  /** 노드의 유효 기한 — {@code escalateFirst} 면 다시 알림 없이 기한 뒤 바로 관리자에게, 아니면 담당에게 먼저 알린 뒤 같은 기간 뒤 관리자에게. */
  private record Window(Duration after, boolean escalateFirst) {}

  private final WorkflowRunRepository runRepository;
  private final WorkflowModelLoader modelLoader;
  private final ApplicationEventPublisher publisher;
  private final ObjectMapper objectMapper;

  /** 방문별 세이브포인트 템플릿 — 바깥 트랜잭션(테넌트 러너)의 세이브포인트로 돌아 GUC 는 바깥 트랜잭션 것을 그대로 쓴다. */
  private final TransactionTemplate nested;

  public WorkflowTimerService(
      WorkflowRunRepository runRepository,
      WorkflowModelLoader modelLoader,
      ApplicationEventPublisher publisher,
      ObjectMapper objectMapper,
      PlatformTransactionManager txManager) {
    this.runRepository = runRepository;
    this.modelLoader = modelLoader;
    this.publisher = publisher;
    this.objectMapper = objectMapper;
    this.nested = new TransactionTemplate(txManager);
    this.nested.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
  }

  /**
   * 기한이 된 방문마다 알림과 표시 이벤트를 남긴다. 버전별 모델·실행은 이 호출 안에서 한 번만 읽는다.
   *
   * <p>기한 전 방문은 실행·모델과 방문 시각만으로 걸러 세이브포인트·잠금을 열지 않는다. 기한이 지난 방문만 방문별 세이브포인트(NESTED)에서 행을 잠근 뒤 이벤트를
   * 다시 확인해 처리한다 — 한 방문의 SQL 실패·rollback-only 가 테넌트 트랜잭션 전체(다른 방문의 이벤트·알림)를 버리지 않게.
   *
   * @return 남긴 표시 이벤트(TIMER_REMIND·TIMER_ESCALATE) 수
   */
  public int runDue(Instant now) {
    // 없는 실행·모델도 Optional.empty 로 담아 같은 호출 안에서 다시 조회하지 않는다.
    Map<Long, Optional<WorkflowModel>> models = new HashMap<>();
    Map<Long, Optional<RunRow>> runs = new HashMap<>();
    int marked = 0;
    for (NodeRunRow visit : runRepository.findActiveNodeRunsOfOpenRuns()) {
      try {
        RunRow run = cached(runs, visit.runId(), runRepository::findRun).orElse(null);
        if (run == null) continue;
        WorkflowModel model = cached(models, run.versionId(), modelLoader::find).orElse(null);
        if (model == null) continue;
        Window window = window(model.nodes().get(visit.nodeKey()));
        // 다시 알림 시각은 들어간 시각 이후이므로, 첫 기한 전이면 어느 단계도 아직이다.
        if (window == null || visit.enteredAt().plus(window.after()).isAfter(now)) continue;
        Boolean acted = nested.execute(s -> handle(run, visit, window, now));
        if (Boolean.TRUE.equals(acted)) marked++;
      } catch (Exception e) {
        // 한 방문의 실패가 나머지 방문을 막지 않게 한다.
        log.warn("[workflow-timer] 방문 {} 처리 실패 — 건너뜀", visit.id(), e);
      }
    }
    return marked;
  }

  /** 호출 안 캐시 조회 — 없는 값도 담고, 처음 읽을 때의 DB 오류가 번지지 않게 세이브포인트 안에서 읽는다. */
  private <V> Optional<V> cached(
      Map<Long, Optional<V>> cache, long key, Function<Long, Optional<V>> loader) {
    Optional<V> hit = cache.get(key);
    if (hit != null) return hit;
    Optional<V> loaded = nested.execute(s -> loader.apply(key));
    cache.put(key, loaded);
    return loaded;
  }

  /**
   * 기한이 된 방문 하나를 처리한다(세이브포인트 안). 이미 다시 알렸고 관리자 기한이 아직이면 잠그지 않고 끝낸다. 그 밖에는 방문 행을 잠가 — 다른 파드의 poll 이
   * 같은 방문을 동시에 처리하지 못하게 — 커밋된 표시 이벤트를 다시 읽고 판정한다.
   *
   * @return 표시 이벤트를 남겼는지
   */
  private boolean handle(RunRow run, NodeRunRow visit, Window window, Instant now) {
    if (!window.escalateFirst()) {
      Optional<RunEventRow> early = findEvent(run, visit, WorkflowRunWriter.TIMER_REMIND);
      if (early.isPresent() && early.get().at().plus(window.after()).isAfter(now)) return false;
    }
    if (!runRepository.lockActiveNodeRun(visit.id())) return false;

    // 잠근 뒤 다시 읽는다 — 동시에 처리한 쪽의 표시가 보인다. 이미 관리자에게 알렸으면 끝이다(두 갈래 공통).
    if (findEvent(run, visit, WorkflowRunWriter.TIMER_ESCALATE).isPresent()) return false;
    if (window.escalateFirst()) {
      escalate(run, visit, now);
      return true;
    }
    Optional<RunEventRow> remind = findEvent(run, visit, WorkflowRunWriter.TIMER_REMIND);
    if (remind.isEmpty()) {
      remind(run, visit, now);
      return true;
    }
    // 다시 알린 뒤 같은 기간이 또 지나면 관리자에게 알린다.
    if (remind.get().at().plus(window.after()).isAfter(now)) return false;
    escalate(run, visit, now);
    return true;
  }

  private Optional<RunEventRow> findEvent(RunRow run, NodeRunRow visit, String type) {
    return runRepository.findVisitEvent(run.id(), type, visit.id());
  }

  /** 유효 기한 — 적은 timeout 우선, 없으면 human_task 만 기본값, 그 밖은 대상 아님(null). 알 수 없는 then 은 remind 로 본다. */
  private static Window window(Node node) {
    if (node == null || !NodeTypes.isTask(node)) return null;
    var t = node.timeout();
    if (t != null && t.after() != null) return new Window(t.after(), "escalate".equals(t.then()));
    if (!NodeTypes.HUMAN_TASK.equals(node.type())) return null;
    return new Window(node.returnTo() != null ? DEFAULT_ANSWER : DEFAULT_TASK, false);
  }

  /** 담당에게 다시 알린다 — 이벤트를 먼저 남기고, 담당이 없으면 알림 이벤트만 생략한다. */
  private void remind(RunRow run, NodeRunRow visit, Instant now) {
    mark(run, visit, WorkflowRunWriter.TIMER_REMIND, now);
    if (!visit.assigneeIds().isEmpty()) {
      publisher.publishEvent(
          new WorkflowTurnRemind(
              TenantContext.get(), run.id(), run.issueId(), visit.nodeKey(), visit.assigneeIds()));
    }
  }

  /** 프로젝트 관리자에게 알린다 — 이벤트를 먼저 남기고, 받는 사람(관리자)은 알림 쪽이 정한다(비면 알림만 생략). 모듈 경계상 알림 모듈은 이벤트로만 부른다. */
  private void escalate(RunRow run, NodeRunRow visit, Instant now) {
    mark(run, visit, WorkflowRunWriter.TIMER_ESCALATE, now);
    publisher.publishEvent(
        new WorkflowTurnEscalate(TenantContext.get(), run.id(), run.issueId(), visit.nodeKey()));
  }

  /** 표시 이벤트를 쌓는다 — payload {nodeRunId, node}, 행위자 없음. */
  private void mark(RunRow run, NodeRunRow visit, String type, Instant now) {
    String payload =
        objectMapper.writeValueAsString(Map.of("nodeRunId", visit.id(), "node", visit.nodeKey()));
    runRepository.insertEvent(run.id(), type, payload, null, now);
  }
}
