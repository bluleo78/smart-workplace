package com.workplace.issue.workflow.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowVisitLimitReached;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModel.Outcome;
import com.workplace.issue.workflow.domain.WorkflowRouting.Route;
import com.workplace.issue.workflow.domain.WorkflowRouting.Step;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import tools.jackson.databind.json.JsonMapper;

/**
 * WP-1985 후처리의 실행 이벤트 actor_id 규칙(단위 테스트, Spring 없음) — 자동으로 지난 노드에서 낸 VISIT_LIMIT 은 actor_id 가 null
 * 이고, 알림 이벤트의 행위자는 이동을 일으킨 사람 그대로다.
 *
 * <p>왜 단위 테스트: 게시 검증기가 decision·start 에 maxVisits 를 받지 않아(x-nodeTypes) 게시본으로는 이 경로를 만들 수 없다. 모델을 직접
 * 만들어 후처리 규칙만 확인한다(저장된 모델이 검증을 거치지 않은 경우의 방어).
 */
class WorkflowRunWriterTest {

  private static final long ACTOR = 7L;
  private static final long RUN = 100L;
  private static final long ISSUE = 200L;

  private final WorkflowRunRepository runRepository = mock(WorkflowRunRepository.class);
  private final ApplicationEventPublisher publisher = mock(ApplicationEventPublisher.class);
  private final WorkflowRunWriter writer =
      new WorkflowRunWriter(
          runRepository,
          mock(IssueAssigneeService.class),
          mock(IssueCommentService.class),
          mock(IssueChangeNotifier.class),
          publisher,
          JsonMapper.builder().build());

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clear() {
    TenantContext.clear();
  }

  /** maxVisits 가 있는 노드 하나(나머지 칸은 비움). */
  private static Node node(String key, String type, String role, String defaultTo, Integer max) {
    LinkedHashMap<String, Outcome> outcomes = new LinkedHashMap<>();
    if ("human_task".equals(type)) {
      outcomes.put("done", new Outcome("done", "end", null, false));
    }
    return new Node(
        key, type, null, role, null, null, null, null, outcomes, null, defaultTo, max, null, null,
        null);
  }

  @Test
  @DisplayName("decision 을 자동으로 지나며 되돌림 한도에 이르면 VISIT_LIMIT 의 actor_id 는 null, 알림 행위자는 이동한 사람")
  void autoPassedDecision_visitLimit_actorNull() {
    LinkedHashMap<String, Node> nodes = new LinkedHashMap<>();
    nodes.put("d", node("d", "decision", null, "t", 1));
    nodes.put("t", node("t", "human_task", "r", null, null));
    nodes.put("end", node("end", "end", null, null, null));
    WorkflowModel model = new WorkflowModel(null, null, null, null, nodes, null, null);
    Instant now = Instant.parse("2026-11-23T00:00:00Z");

    writer.enter(
        new WorkflowRunWriter.Entry(
            RUN,
            ISSUE,
            model,
            List.of(),
            null,
            null,
            new Route(List.of(new Step("d", "t")), "t", false),
            List.of(ACTOR),
            List.of(),
            List.of(),
            List.of(),
            ACTOR,
            now));

    verify(runRepository)
        .insertEvent(eq(RUN), eq(WorkflowRunWriter.VISIT_LIMIT), anyString(), isNull(), eq(now));
    ArgumentCaptor<Object> published = ArgumentCaptor.forClass(Object.class);
    verify(publisher, org.mockito.Mockito.atLeastOnce()).publishEvent(published.capture());
    List<WorkflowVisitLimitReached> limits =
        published.getAllValues().stream()
            .filter(WorkflowVisitLimitReached.class::isInstance)
            .map(WorkflowVisitLimitReached.class::cast)
            .toList();
    assertThat(limits).hasSize(1);
    assertThat(limits.getFirst().nodeKey()).isEqualTo("d");
    assertThat(limits.getFirst().actorId()).isEqualTo(ACTOR);
  }

  @Test
  @DisplayName("사람이 직접 들어간(머무는) 노드의 VISIT_LIMIT 은 요청자를 적는다")
  void stopNode_visitLimit_actorIsRequester() {
    LinkedHashMap<String, Node> nodes = new LinkedHashMap<>();
    nodes.put("t", node("t", "human_task", "r", null, 1));
    nodes.put("end", node("end", "end", null, null, null));
    WorkflowModel model = new WorkflowModel(null, null, null, null, nodes, null, null);
    Instant now = Instant.parse("2026-11-23T00:00:00Z");

    writer.enter(
        new WorkflowRunWriter.Entry(
            RUN,
            ISSUE,
            model,
            List.of(),
            null,
            null,
            new Route(List.of(), "t", false),
            List.of(ACTOR),
            List.of(),
            List.of(),
            List.of(),
            ACTOR,
            now));

    verify(runRepository)
        .insertEvent(eq(RUN), eq(WorkflowRunWriter.VISIT_LIMIT), anyString(), eq(ACTOR), any());
    verify(runRepository, org.mockito.Mockito.never())
        .insertEvent(anyLong(), eq(WorkflowRunWriter.VISIT_LIMIT), anyString(), isNull(), any());
  }
}
