package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.project.dto.CreateProjectRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈에 구성요소 붙이기·떼기(WP-933) — PUT 전체 교체의 diff 이력, 보관된 구성요소 규칙(새로 붙이기 거절·이미 붙은 것 유지), 다른 프로젝트 id 거절,
 * 비멤버 거절, 상세·목록 응답의 components.
 */
@Transactional
class IssueComponentTest extends IssueComponentTestSupport {

  /** 빈 → [A,B] → [B] 로 바꾸면 이력이 두 건 남고, 같은 집합을 다시 보내면 기록이 없다. */
  @Test
  void replaceRecordsDiff() throws Exception {
    long a = component("Alpha", null);
    long b = component("Beta", null);
    JsonNode issue = createdIssue(ownerId, Map.of());
    int number = issue.get("number").asInt();
    long issueId = issue.get("id").asLong();

    replaceComponents(woodyId, number, List.of(b, a))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].name").value("Alpha"))
        .andExpect(jsonPath("$[1].name").value("Beta"));
    replaceComponents(woodyId, number, List.of(b))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(1))
        .andExpect(jsonPath("$[0].id").value(b));
    replaceComponents(woodyId, number, List.of(b)).andExpect(status().isOk());

    List<JsonNode> rows = history(issueId, "COMPONENTS_CHANGED");
    assertThat(rows).hasSize(2);
    assertThat(names(rows.get(0).get("added"))).containsExactly("Alpha", "Beta");
    assertThat(rows.get(0).get("added").get(0).get("id").asLong()).isEqualTo(a);
    assertThat(rows.get(0).get("removed")).isEmpty();
    assertThat(rows.get(1).get("added")).isEmpty();
    assertThat(names(rows.get(1).get("removed"))).containsExactly("Alpha");
    assertThat(rows.get(1).get("removed").get(0).get("id").asLong()).isEqualTo(a);
  }

  /** 붙어 있던 A 를 보관해도 [A] 재전송은 통과하고, 보관된 C 를 새로 붙이면 400 COMPONENT_ARCHIVED. */
  @Test
  void archivedCannotBeAddedButKept() throws Exception {
    long a = component("Alpha", null);
    long c = component("Charlie", null);
    archive(c);
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();
    replaceComponents(ownerId, number, List.of(a)).andExpect(status().isOk());
    archive(a);

    replaceComponents(ownerId, number, List.of(a))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].archived").value(true));
    replaceComponents(ownerId, number, List.of(a, c))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("COMPONENT_ARCHIVED"));
  }

  /** 다른 프로젝트의 구성요소 id 는 400 COMPONENT_NOT_FOUND. */
  @Test
  void otherProjectComponentRejected() throws Exception {
    String otherKey = key.substring(0, 6) + "Z";
    long otherProject =
        projectService.create(ownerId, new CreateProjectRequest(otherKey, "다른", "x", "OPEN")).id();
    long foreign =
        dsl.insertInto(com.workplace.jooq.Tables.PROJECT_COMPONENT)
            .set(com.workplace.jooq.Tables.PROJECT_COMPONENT.PROJECT_ID, otherProject)
            .set(com.workplace.jooq.Tables.PROJECT_COMPONENT.NAME, "Foreign")
            .returning(com.workplace.jooq.Tables.PROJECT_COMPONENT.ID)
            .fetchOne()
            .getId();
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();

    replaceComponents(ownerId, number, List.of(foreign))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("COMPONENT_NOT_FOUND"));
    replaceComponents(ownerId, number, List.of(999_999_999L))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("COMPONENT_NOT_FOUND"));
  }

  /** OPEN 프로젝트를 읽을 수 있는 비멤버도 구성요소를 바꿀 수는 없다(라벨과 같은 멤버 가드). */
  @Test
  void nonMemberCannotReplace() throws Exception {
    long a = component("Alpha", null);
    int number = createdIssue(ownerId, Map.of()).get("number").asInt();
    replaceComponents(outsiderId, number, List.of(a)).andExpect(status().isForbidden());
  }

  /** 상세·목록 응답 모두 components 를 목록 순서(이름)로 싣고, 없는 이슈는 빈 배열. */
  @Test
  void detailAndListIncludeComponents() throws Exception {
    long n = component("network", null);
    long c = component("Compute", null);
    int number = createdIssue(ownerId, Map.of("componentIds", List.of(n, c))).get("number").asInt();
    int bare = createdIssue(ownerId, Map.of()).get("number").asInt();

    JsonNode detail =
        json(
            call(get("/api/v1/projects/" + key + "/issues/" + number), ownerId)
                .andExpect(status().isOk()));
    assertThat(names(detail.get("summary").get("components")))
        .containsExactly("Compute", "network");

    JsonNode list =
        json(call(get("/api/v1/projects/" + key + "/issues"), ownerId).andExpect(status().isOk()));
    JsonNode items = list.get("items");
    boolean sawBare = false;
    boolean sawTagged = false;
    for (JsonNode it : items) {
      if (it.get("number").asInt() == number) {
        assertThat(names(it.get("components"))).containsExactly("Compute", "network");
        sawTagged = true;
      } else if (it.get("number").asInt() == bare) {
        assertThat(it.get("components").isArray()).isTrue();
        assertThat(it.get("components")).isEmpty();
        sawBare = true;
      }
    }
    assertThat(sawTagged).isTrue();
    assertThat(sawBare).isTrue();
  }

  private static List<String> names(JsonNode arr) {
    List<String> out = new ArrayList<>();
    arr.forEach(n -> out.add(n.get("name").asText()));
    return out;
  }
}
