package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 구성요소 담당자 자동 지정(WP-933 §4.3) — 담당자 없이 만든 이슈에 고른 구성요소 중 목록 순서로 처음 유효한 담당자를 붙이고, 일반 담당자 지정과 같은
 * 이벤트·워처·이력을 남긴다. 담당자를 직접 고르면 끼어들지 않고, 무효 담당자는 건너뛰며, 비멤버는 구성요소를 넘길 수 없다.
 *
 * <p>테스트 트랜잭션 안이라 AFTER_COMMIT 리스너는 돌지 않는다 — 발행된 이벤트 자체를 {@link RecordApplicationEvents} 로 본다.
 */
@Transactional
@RecordApplicationEvents
class IssueComponentAutoAssignTest extends IssueComponentTestSupport {

  @Autowired ApplicationEvents events;

  /** [Network(woody), Compute(soon)] → 이름순으로 Compute 가 먼저라 soon 이 담당자, 이벤트·워처·이력 한 건. */
  @Test
  void autoAssignsFirstComponentAssignee() throws Exception {
    long network = component("Network", woodyId);
    long compute = component("Compute", soonId);

    JsonNode issue =
        json(
            createIssue(ownerId, Map.of("componentIds", List.of(network, compute)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignees.length()").value(1))
                .andExpect(jsonPath("$.assignees[0].id").value(soonId))
                .andExpect(jsonPath("$.components[0].name").value("Compute")));
    long issueId = issue.get("id").asLong();

    var assigned = events.stream(IssueAssignedEvent.class).toList();
    assertThat(assigned).hasSize(1);
    assertThat(assigned.get(0).added()).extracting(u -> u.id()).containsExactly(soonId);
    assertThat(isWatcher(issueId, soonId)).isTrue();

    List<JsonNode> rows = history(issueId, "ASSIGNEES_CHANGED");
    assertThat(rows).hasSize(1);
    JsonNode p = rows.get(0);
    assertThat(p.get("reason").asText()).isEqualTo("COMPONENT_DEFAULT");
    assertThat(p.get("componentId").asLong()).isEqualTo(compute);
    assertThat(p.get("componentName").asText()).isEqualTo("Compute");
    assertThat(p.get("added").get(0).get("id").asLong()).isEqualTo(soonId);
    assertThat(p.get("removed")).isEmpty();
  }

  /** 담당자를 직접 고르면 그 담당자만 — 자동 지정 이력은 없다. */
  @Test
  void explicitAssigneeWins() throws Exception {
    long compute = component("Compute", soonId);
    JsonNode issue =
        json(
            createIssue(
                    ownerId,
                    Map.of("componentIds", List.of(compute), "assigneeIds", List.of(woodyId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignees.length()").value(1))
                .andExpect(jsonPath("$.assignees[0].id").value(woodyId)));
    assertThat(history(issue.get("id").asLong(), "ASSIGNEES_CHANGED")).isEmpty();
  }

  /** 첫 구성요소(Compute) 담당자가 구성원에서 빠졌으면 다음(Network) 담당자로 넘어간다. */
  @Test
  void autoAssignSkipsInvalidAssignee() throws Exception {
    long network = component("Network", woodyId);
    long compute = component("Compute", soonId);
    projectService.removeMember(ownerId, key, soonId);

    createIssue(ownerId, Map.of("componentIds", List.of(compute, network)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.assignees.length()").value(1))
        .andExpect(jsonPath("$.assignees[0].id").value(woodyId));
  }

  /** 담당자가 없는 구성요소만 고르면 담당자 없음, 이력 없음, 지정 이벤트 없음. */
  @Test
  void noAssigneeNoChange() throws Exception {
    long compute = component("Compute", null);
    JsonNode issue =
        json(
            createIssue(ownerId, Map.of("componentIds", List.of(compute)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignees.length()").value(0)));
    assertThat(history(issue.get("id").asLong(), "ASSIGNEES_CHANGED")).isEmpty();
    assertThat(events.stream(IssueAssignedEvent.class).count()).isZero();
  }

  /** 보관된 구성요소로는 만들 수 없다(400 COMPONENT_ARCHIVED). */
  @Test
  void archivedComponentRejectedOnCreate() throws Exception {
    long compute = component("Compute", soonId);
    archive(compute);
    createIssue(ownerId, Map.of("componentIds", List.of(compute)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("COMPONENT_ARCHIVED"));
  }

  /** OPEN 프로젝트 비구성원은 componentIds 를 넘기면 라벨과 같은 403, 구성요소 없이 만들면 200·담당자 없음. */
  @Test
  void nonMemberCreateWithComponentsRejected() throws Exception {
    long compute = component("Compute", soonId);
    createIssue(outsiderId, Map.of("componentIds", List.of(compute)))
        .andExpect(status().isForbidden());
    createIssue(outsiderId, Map.of())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.assignees.length()").value(0))
        .andExpect(jsonPath("$.components.length()").value(0));
  }

  /** 만든 뒤 PUT 으로 담당자 있는 구성요소를 붙여도 담당자는 그대로(비어 있음). */
  @Test
  void updateDoesNotReassign() throws Exception {
    long compute = component("Compute", soonId);
    JsonNode issue = createdIssue(ownerId, Map.of());
    replaceComponents(ownerId, issue.get("number").asInt(), List.of(compute))
        .andExpect(status().isOk());
    assertThat(
            dsl.fetchCount(
                dsl.selectOne()
                    .from("issue_assignee")
                    .where("issue_id = ?", issue.get("id").asLong())))
        .isZero();
  }

  private boolean isWatcher(long issueId, long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from("issue_watcher")
            .where("issue_id = ? AND user_id = ?", issueId, userId));
  }
}
