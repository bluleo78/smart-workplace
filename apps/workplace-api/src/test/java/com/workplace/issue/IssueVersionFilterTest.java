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
 * 버전 검색 필터(WP-888) — {@code fixVersion}·{@code affectsVersion} 은 id·이름(대소문자 무시) CSV 의 OR, {@code
 * none} 은 그 종류 버전이 없는 이슈, 두 필터는 서로 AND, 보관된 버전으로도 거를 수 있고, 저장된 뷰는 쿼리 문자열을 그대로 보존한다.
 */
@Transactional
class IssueVersionFilterTest extends IssueVersionTestSupport {

  private long alpha;
  private long beta;
  private int issueA;
  private int issueB;
  private int issueBoth;
  private int issueNone;

  /** A 가 수정 버전인 이슈, B 가 수정 버전인 이슈, A 수정·B 영향인 이슈, 버전 없는 이슈. */
  @BeforeEach
  void seedIssues() throws Exception {
    alpha = version("Alpha");
    beta = version("Beta");
    issueA = newIssue();
    issueB = newIssue();
    issueBoth = newIssue();
    issueNone = newIssue();
    replaceVersions(ownerId, issueA, List.of(alpha), null).andExpect(status().isOk());
    replaceVersions(ownerId, issueB, List.of(beta), null).andExpect(status().isOk());
    replaceVersions(ownerId, issueBoth, List.of(alpha), List.of(beta)).andExpect(status().isOk());
  }

  private int newIssue() throws Exception {
    return createdIssue(ownerId, Map.of()).get("number").asInt();
  }

  /** id 두 개를 주면 둘 중 하나라도 수정 버전으로 붙은 이슈. */
  @Test
  void fixFilterOrById() throws Exception {
    assertThat(search("fixVersion", alpha + "," + beta))
        .containsExactlyInAnyOrder(issueA, issueB, issueBoth);
  }

  /** 이름은 대소문자를 무시한다. */
  @Test
  void fixFilterByNameIgnoringCase() throws Exception {
    assertThat(search("fixVersion", "beta")).containsExactly(issueB);
  }

  /** none 은 수정 버전이 없는 이슈만. */
  @Test
  void fixFilterNone() throws Exception {
    assertThat(search("fixVersion", "none")).containsExactly(issueNone);
    assertThat(search("fixVersion", "none," + beta)).containsExactlyInAnyOrder(issueNone, issueB);
  }

  /** 수정 버전으로만 붙은 이슈는 영향 버전 필터에 나오지 않는다. */
  @Test
  void affectsFilterSeparate() throws Exception {
    assertThat(search("affectsVersion", "Alpha")).isEmpty();
    assertThat(search("affectsVersion", "Beta")).containsExactly(issueBoth);
    assertThat(search("affectsVersion", "none"))
        .containsExactlyInAnyOrder(issueA, issueB, issueNone);
  }

  /** 두 필터를 함께 주면 AND. */
  @Test
  void bothFiltersAnd() throws Exception {
    JsonNode res =
        json(
            call(
                    get("/api/v1/projects/" + key + "/issues")
                        .param("fixVersion", "Alpha")
                        .param("affectsVersion", "Beta"),
                    ownerId)
                .andExpect(status().isOk()));
    List<Integer> out = new ArrayList<>();
    res.get("items").forEach(it -> out.add(it.get("number").asInt()));
    assertThat(out).containsExactly(issueBoth);
  }

  /** 보관된 버전으로도 거를 수 있다(지난 이슈 찾기). */
  @Test
  void filterIncludesArchived() throws Exception {
    archiveVersion(alpha);
    assertThat(search("fixVersion", "Alpha")).containsExactlyInAnyOrder(issueA, issueBoth);
    assertThat(search("fixVersion", String.valueOf(alpha)))
        .containsExactlyInAnyOrder(issueA, issueBoth);
  }

  /** 없는 이름은 400 — 필터 없는 전체 목록을 돌려주지 않는다. */
  @Test
  void unknownNameRejected() throws Exception {
    call(get("/api/v1/projects/" + key + "/issues").param("fixVersion", "Nope"), ownerId)
        .andExpect(status().isBadRequest());
  }

  /** 버전 필터를 담은 저장된 뷰는 query 문자열을 그대로 돌려준다. */
  @Test
  void savedViewQueryRoundTrip() throws Exception {
    String query = "fixVersion=" + alpha + ",none&affectsVersion=Beta&status=TODO";
    String base = "/api/v1/projects/" + key + "/saved-views";
    call(
            post(base)
                .content(
                    om.writeValueAsString(
                        Map.of("name", "버전 뷰", "query", query, "visibility", "PRIVATE"))),
            ownerId)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.query").value(query));
    JsonNode list = json(call(get(base), ownerId).andExpect(status().isOk()));
    List<String> queries = new ArrayList<>();
    list.forEach(v -> queries.add(v.get("query").asText()));
    assertThat(queries).contains(query);
  }

  /** 한 파라미터로 검색한 이슈 번호들. */
  private List<Integer> search(String param, String value) throws Exception {
    JsonNode res =
        json(
            call(get("/api/v1/projects/" + key + "/issues").param(param, value), ownerId)
                .andExpect(status().isOk()));
    List<Integer> out = new ArrayList<>();
    res.get("items").forEach(it -> out.add(it.get("number").asInt()));
    return out;
  }
}
