package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.global.security.AgentToolContext;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.service.IssueVersionService;
import com.workplace.project.dto.CreateProjectRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈에 수정 버전·영향 버전 붙이기·떼기(WP-888) — 종류별 diff 이력, 두 종류의 독립, 보관 버전 규칙(새로 붙이기 거절·이미 붙은 것 유지), 출시 버전 허용,
 * 다른 프로젝트 id 거절, 비멤버 거절, 상세·목록 응답, AI 작업을 시작하지 않는 알림.
 */
@Transactional
@RecordApplicationEvents
class IssueVersionTest extends IssueVersionTestSupport {

  @Autowired ApplicationEvents events;
  @Autowired IssueVersionService issueVersionService;
  @Autowired com.workplace.issue.outbound.IssueChangeNotifier changeNotifier;
  @Autowired com.workplace.project.repository.ProjectRepository projectRepository;

  /** fix [A,B] → [B] 는 수정 버전 이력 두 건, 영향 버전 이력은 없고, 같은 집합 재전송은 기록이 없다. */
  @Test
  void replaceRecordsDiffPerKind() throws Exception {
    long a = version("A");
    long b = version("B");
    JsonNode issue = createdIssue(ownerId, Map.of());
    int number = issue.get("number").asInt();
    long issueId = issue.get("id").asLong();

    replaceVersions(woodyId, number, List.of(a, b), null).andExpect(status().isOk());
    replaceVersions(woodyId, number, List.of(b), null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.fixVersions.length()").value(1))
        .andExpect(jsonPath("$.fixVersions[0].id").value(b))
        .andExpect(jsonPath("$.affectsVersions.length()").value(0));
    replaceVersions(woodyId, number, List.of(b), null).andExpect(status().isOk());

    List<JsonNode> rows = history(issueId, "FIX_VERSIONS_CHANGED");
    assertThat(rows).hasSize(2);
    assertThat(names(rows.get(0).get("added"))).containsExactly("A", "B");
    assertThat(rows.get(0).get("added").get(0).get("id").asLong()).isEqualTo(a);
    assertThat(rows.get(0).get("removed")).isEmpty();
    assertThat(rows.get(1).get("added")).isEmpty();
    assertThat(names(rows.get(1).get("removed"))).containsExactly("A");
    assertThat(history(issueId, "AFFECTS_VERSIONS_CHANGED")).isEmpty();
  }

  /** 영향 버전만 보내도 수정 버전은 그대로 — 빠진 키는 그 종류를 유지한다. */
  @Test
  void fixAndAffectsIndependent() throws Exception {
    long a = version("A");
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();

    replaceVersions(ownerId, number, List.of(a), null).andExpect(status().isOk());
    replaceVersions(ownerId, number, null, List.of(a))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.fixVersions[0].id").value(a))
        .andExpect(jsonPath("$.affectsVersions[0].id").value(a));
  }

  /** 붙어 있던 A 를 보관해도 [A] 재전송은 통과하고, 보관된 C 를 새로 붙이면 400 VERSION_ARCHIVED. */
  @Test
  void archivedCannotBeAddedButKept() throws Exception {
    long a = version("A");
    long c = version("C");
    archiveVersion(c);
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();
    replaceVersions(ownerId, number, List.of(a), null).andExpect(status().isOk());
    archiveVersion(a);

    replaceVersions(ownerId, number, List.of(a), null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.fixVersions[0].status").value("ARCHIVED"));
    replaceVersions(ownerId, number, List.of(a, c), null)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_ARCHIVED"));
    replaceVersions(ownerId, number, null, List.of(c))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_ARCHIVED"));
  }

  /** 출시된 버전도 자유롭게 붙는다. */
  @Test
  void releasedCanBeAdded() throws Exception {
    long r = version("R");
    releaseVersion(r);
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();
    replaceVersions(ownerId, number, List.of(r), List.of(r))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.fixVersions[0].status").value("RELEASED"))
        .andExpect(jsonPath("$.affectsVersions[0].status").value("RELEASED"));
  }

  /** 다른 프로젝트·없는 버전 id 는 400 VERSION_NOT_FOUND. */
  @Test
  void otherProjectVersionRejected() throws Exception {
    String otherKey = key.substring(0, 6) + "Z";
    long otherProject =
        projectService.create(ownerId, new CreateProjectRequest(otherKey, "다른", "x", "OPEN")).id();
    long foreign =
        dsl.fetchOne(
                "INSERT INTO project_version (project_id, name) VALUES (?, 'Foreign') RETURNING id",
                otherProject)
            .get(0, Long.class);
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();

    replaceVersions(ownerId, number, List.of(foreign), null)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_NOT_FOUND"));
    replaceVersions(ownerId, number, null, List.of(999_999_999L))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_NOT_FOUND"));
  }

  /** OPEN 프로젝트를 읽을 수 있는 비멤버도 버전을 바꿀 수는 없다. */
  @Test
  void nonMemberCannotReplace() throws Exception {
    long a = version("A");
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();
    replaceVersions(outsiderId, number, List.of(a), null).andExpect(status().isForbidden());
  }

  /** 상세·목록 응답 모두 두 종류를 목록 순서로 싣고, 붙지 않은 이슈는 빈 배열. */
  @Test
  void detailAndListIncludeVersions() throws Exception {
    long late = version("Late");
    long early = version("Early");
    dsl.execute("UPDATE project_version SET release_date = '2026-11-01' WHERE id = ?", early);
    dsl.execute("UPDATE project_version SET release_date = '2026-12-01' WHERE id = ?", late);
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();
    int bare = createdIssue(ownerId, Map.of()).get("number").asInt();
    replaceVersions(ownerId, number, List.of(late, early), List.of(early))
        .andExpect(status().isOk());

    JsonNode detail =
        json(
            call(get("/api/v1/projects/" + key + "/issues/" + number), ownerId)
                .andExpect(status().isOk()));
    assertThat(names(detail.get("summary").get("fixVersions"))).containsExactly("Early", "Late");
    assertThat(names(detail.get("summary").get("affectsVersions"))).containsExactly("Early");

    JsonNode list =
        json(call(get("/api/v1/projects/" + key + "/issues"), ownerId).andExpect(status().isOk()));
    boolean sawTagged = false;
    boolean sawBare = false;
    for (JsonNode it : list.get("items")) {
      if (it.get("number").asInt() == number) {
        assertThat(names(it.get("fixVersions"))).containsExactly("Early", "Late");
        assertThat(names(it.get("affectsVersions"))).containsExactly("Early");
        sawTagged = true;
      } else if (it.get("number").asInt() == bare) {
        assertThat(it.get("fixVersions").isArray()).isTrue();
        assertThat(it.get("fixVersions")).isEmpty();
        assertThat(it.get("affectsVersions")).isEmpty();
        sawBare = true;
      }
    }
    assertThat(sawTagged).isTrue();
    assertThat(sawBare).isTrue();
  }

  /**
   * 버전 붙이기는 정리성 쓰기라 AI 작업 터치 이벤트를 내지 않는다. 같은 수행 도구 문맥에서 작업 쓰기(제목 수정)는 이벤트를 내는지 먼저 대조해 거짓 통과를 막는다.
   */
  @Test
  void replaceDoesNotStartAiWork() throws Exception {
    long a = version("A");
    JsonNode issue = createdIssue(ownerId, Map.of());
    int number = issue.get("number").asInt();
    long issueId = issue.get("id").asLong();
    var project = projectRepository.findById(projectId).orElseThrow();

    AgentToolContext.set("test-tool");
    try {
      // 대조군 — 작업 쓰기는 터치 이벤트를 낸다.
      changeNotifier.updated(project, number, issueId, ownerId);
      assertThat(events.stream(AgentToolWriteEvent.class).count()).isEqualTo(1);
      events.clear();

      issueVersionService.applyChange(issueId, "FIX", Set.of(a), Set.of(), ownerId);
      replaceVersions(ownerId, number, null, List.of(a)).andExpect(status().isOk());
      assertThat(events.stream(AgentToolWriteEvent.class).count()).isZero();
    } finally {
      AgentToolContext.clear();
    }
  }

  private static List<String> names(JsonNode arr) {
    List<String> out = new ArrayList<>();
    arr.forEach(n -> out.add(n.get("name").asText()));
    return out;
  }
}
