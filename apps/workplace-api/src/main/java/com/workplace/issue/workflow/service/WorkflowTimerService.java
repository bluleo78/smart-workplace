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
import java.util.List;
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
 * <p>트랜잭션 구조(WP-1987 리뷰): 스케줄러는 테넌트 컨텍스트만 세우고 트랜잭션을 열지 않는다. 이 서비스가 후보 조회 한 번과 기한 지난 방문마다 짧은 트랜잭션을
 * 따로 열어 커밋한다 — 행 잠금(FOR UPDATE)은 그 방문 트랜잭션 동안만 잡히고, 알림 SSE 는 그 방문이 커밋된 뒤 나간다. 트랜잭션 진입 때
 * TenantAwareTransactionManager 가 {@link TenantContext} 로 테넌트 GUC 를 넣어 RLS 가 통한다. 방문 하나가 실패해도 그 방문
 * 트랜잭션만 되돌리고 로그를 남기며 다음 방문으로 간다.
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

  /**
   * 방문(과 후보 조회)마다 쓰는 짧은 트랜잭션 템플릿 — NESTED: 바깥 트랜잭션이 없으면(스케줄러) 새 트랜잭션을 열어 끝에 커밋하고, 바깥 트랜잭션이 있으면(시험
   * 트랜잭션 안에서 직접 부를 때) 그 세이브포인트로 돈다. 어느 쪽이든 한 방문의 실패는 그 방문 범위만 되돌린다.
   *
   * <p>REQUIRES_NEW 를 쓰지 않는 이유: 운영 경로(스케줄러)에는 바깥 트랜잭션이 없어 NESTED 도 방문마다 새 트랜잭션이고 커밋 뒤 SSE 가 그 트랜잭션에
   * 붙는다. REQUIRES_NEW 면 바깥 트랜잭션이 있을 때 커넥션을 하나 더 빌리고, 시험 트랜잭션이 커밋하지 않은 시드를 보지 못한다. 바깥 트랜잭션 안에서 부르면
   * SSE 는 바깥 커밋 뒤로 밀린다(되돌린 세이브포인트의 알림도) — 그런 호출자는 시험뿐이고 시험은 커밋하지 않아 SSE 가 나가지 않는다.
   */
  private final TransactionTemplate visitTx;

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
    this.visitTx = new TransactionTemplate(txManager);
    this.visitTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
  }

  /**
   * 현재 테넌트({@link TenantContext})에서 기한이 된 방문마다 알림과 표시 이벤트를 남긴다. 버전별 모델·실행은 이 호출 안에서 한 번만 읽는다.
   *
   * <p>기한 전 방문은 실행·모델과 방문 시각만으로 걸러 트랜잭션·잠금을 열지 않는다. 기한이 지난 방문만 방문별 짧은 트랜잭션에서 행을 잠근 뒤 실행 상태와 이벤트를 다시
   * 확인해 처리하고 바로 커밋한다 — 잠금을 테넌트 poll 내내 쥐어 사람의 노드 이동을 붙잡지 않고, 한 방문의 SQL 실패가 다른 방문의 이벤트·알림을 버리지 않게.
   *
   * @return 처리한(표시 이벤트 TIMER_REMIND·TIMER_ESCALATE 를 남긴) 방문 수
   */
  public int runDue(Instant now) {
    // 없는 실행·모델도 Optional.empty 로 담아 같은 호출 안에서 다시 조회하지 않는다.
    Map<Long, Optional<WorkflowModel>> models = new HashMap<>();
    Map<Long, Optional<RunRow>> runs = new HashMap<>();
    int marked = 0;
    // 후보 조회도 짧은 트랜잭션에서 — 트랜잭션이 있어야 테넌트 GUC 가 들어가 RLS 테이블이 보인다.
    List<NodeRunRow> visits = visitTx.execute(s -> runRepository.findActiveNodeRunsOfOpenRuns());
    for (NodeRunRow visit : visits) {
      try {
        RunRow run = cached(runs, visit.runId(), runRepository::findRun).orElse(null);
        if (run == null) continue;
        WorkflowModel model = cached(models, run.versionId(), modelLoader::find).orElse(null);
        if (model == null) continue;
        Window window = window(model.nodes().get(visit.nodeKey()));
        // 다시 알림 시각은 들어간 시각 이후이므로, 첫 기한 전이면 어느 단계도 아직이다.
        if (window == null || visit.enteredAt().plus(window.after()).isAfter(now)) continue;
        Boolean acted = visitTx.execute(s -> handle(run, visit, window, now));
        if (Boolean.TRUE.equals(acted)) marked++;
      } catch (Exception e) {
        // 한 방문의 실패가 나머지 방문을 막지 않게 한다.
        log.warn("[workflow-timer] 방문 {} 처리 실패 — 건너뜀", visit.id(), e);
      }
    }
    return marked;
  }

  /** 호출 안 캐시 조회 — 없는 값도 담고, 처음 읽을 때의 DB 오류가 번지지 않게 짧은 트랜잭션(또는 세이브포인트) 안에서 읽는다. */
  private <V> Optional<V> cached(
      Map<Long, Optional<V>> cache, long key, Function<Long, Optional<V>> loader) {
    Optional<V> hit = cache.get(key);
    if (hit != null) return hit;
    Optional<V> loaded = visitTx.execute(s -> loader.apply(key));
    cache.put(key, loaded);
    return loaded;
  }

  /**
   * 기한이 된 방문 하나를 처리한다(방문 트랜잭션 안). 이미 다시 알렸고 관리자 기한이 아직이면 잠그지 않고 끝낸다. 그 밖에는 방문 행을 잠가 — 다른 파드의 poll 이
   * 같은 방문을 동시에 처리하지 못하게 — 커밋된 표시 이벤트를 다시 읽고 판정한다. 잠글 때 실행이 아직 열려(RUNNING·WAITING) 있는지도 다시 본다 — 후보
   * 조회 뒤 멈춤(SUSPENDED)·취소된 실행에는 알리지 않는다.
   *
   * @return 표시 이벤트를 남겼는지
   */
  private boolean handle(RunRow run, NodeRunRow visit, Window window, Instant now) {
    if (!window.escalateFirst()) {
      Optional<RunEventRow> early = findEvent(run, visit, WorkflowRunWriter.TIMER_REMIND);
      if (early.isPresent() && early.get().at().plus(window.after()).isAfter(now)) return false;
    }
    if (!runRepository.lockActiveNodeRunOfOpenRun(run.id(), visit.id())) return false;

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
