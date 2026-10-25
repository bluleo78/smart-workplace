package com.workplace.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

/**
 * 구성요소 검색 필터(WP-933) — {@code component} 는 id·이름(대소문자 무시) CSV 의 OR, {@code none} 은 구성요소 없는 이슈, 보관된
 * 구성요소로도 거를 수 있고, 저장된 뷰는 그 쿼리 문자열을 그대로 보존한다.
 */
@Transactional
class IssueComponentFilterTest extends IssueComponentTestSupport {

  private long alpha;
  private long compute;
  private int issueA;
  private int issueB;
  private int issueNone;

  /** A 가 붙은 이슈, Compute 가 붙은 이슈, 구성요소 없는 이슈를 하나씩 만든다. */
  @BeforeEach
  void seedIssues() throws Exception {
    alpha = component("Alpha", null);
    compute = component("Compute", null);
    issueA = createdIssue(ownerId, Map.of("componentIds", List.of(alpha))).get("number").asInt();
    issueB = createdIssue(ownerId, Map.of("componentIds", List.of(compute))).get("number").asInt();
    issueNone = createdIssue(ownerId, Map.of()).get("number").asInt();
  }

  /** id 두 개를 주면 둘 중 하나라도 붙은 두 건. */
  @Test
  void filterOrById() throws Exception {
    assertThat(search(alpha + "," + compute)).containsExactlyInAnyOrder(issueA, issueB);
  }

  /** 이름은 대소문자를 무시한다. */
  @Test
  void filterByNameIgnoringCase() throws Exception {
    assertThat(search("compute")).containsExactly(issueB);
  }

  /** 분해형(NFD) 한글 토큰도 NFC 로 저장된 이름과 같은 구성요소로 풀린다 — 저장 이름과 같은 정규화 규칙. */
  @Test
  void filterByNameNormalizesNfd() throws Exception {
    long korean = component("컴퓨트", null);
    int issueK =
        createdIssue(ownerId, Map.of("componentIds", List.of(korean))).get("number").asInt();
    String nfd = java.text.Normalizer.normalize("컴퓨트", java.text.Normalizer.Form.NFD);
    assertThat(nfd).isNotEqualTo("컴퓨트");
    assertThat(search(nfd)).containsExactly(issueK);
  }

  /** none 은 구성요소가 없는 이슈만. */
  @Test
  void filterNone() throws Exception {
    assertThat(search("none")).containsExactly(issueNone);
  }

  /** 보관된 구성요소로도 거를 수 있다(지난 이슈 찾기). */
  @Test
  void filterIncludesArchived() throws Exception {
    archive(alpha);
    assertThat(search("Alpha")).containsExactly(issueA);
    assertThat(search(String.valueOf(alpha))).containsExactly(issueA);
  }

  /** component 를 담은 저장된 뷰는 query 문자열을 그대로 돌려준다. */
  @Test
  void savedViewQueryRoundTrip() throws Exception {
    String query = "component=" + alpha + ",none&status=TODO";
    String base = "/api/v1/projects/" + key + "/saved-views";
    call(
            post(base)
                .content(
                    om.writeValueAsString(
                        Map.of("name", "구성요소 뷰", "query", query, "visibility", "PRIVATE"))),
            ownerId)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.query").value(query));
    JsonNode list = json(call(get(base), ownerId).andExpect(status().isOk()));
    List<String> queries = new ArrayList<>();
    list.forEach(v -> queries.add(v.get("query").asText()));
    assertThat(queries).contains(query);
  }

  /** component 파라미터로 검색한 이슈 번호들. */
  private List<Integer> search(String component) throws Exception {
    JsonNode res =
        json(
            call(get("/api/v1/projects/" + key + "/issues").param("component", component), ownerId)
                .andExpect(status().isOk()));
    List<Integer> out = new ArrayList<>();
    res.get("items").forEach(it -> out.add(it.get("number").asInt()));
    return out;
  }
}
