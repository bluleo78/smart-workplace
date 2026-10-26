package com.workplace.version;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.global.tenant.TenantContext;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-888 버전 삭제 — 보관한 것만 지운다(서버도 막음), 떼기/같은 종류로 옮기기와 종류별 이력, 옮길 대상 검증, 삭제 전 이슈 수.
 *
 * <p>@Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다.
 */
@Transactional
class VersionDeleteTest extends VersionOpsTestSupport {

  private static final String ARCHIVED_AT = "2026-01-01T00:00:00Z";

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    seedProject();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 보관 안 된 버전은 400 VERSION_NOT_ARCHIVED 로 남는다. */
  @Test
  void deleteRequiresArchived() throws Exception {
    long v = version("1.0");
    call(delete(base + "/" + v), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_NOT_ARCHIVED"));
    assertThat(dsl.fetchCount(dsl.selectOne().from("project_version").where("id = " + v)))
        .isEqualTo(1);
    // 일반 멤버는 보관된 것도 못 지운다.
    long a = insertVersion(projectId, "A", null, null, null, ARCHIVED_AT);
    call(delete(base + "/" + a), memberId).andExpect(status().isForbidden());
  }

  /** moveTo 없이 지우면 연결만 떼고, 이슈마다 종류별 이력이 1건씩 남는다. */
  @Test
  void deleteDetaches() throws Exception {
    long v = insertVersion(projectId, "1.0", null, null, null, ARCHIVED_AT);
    long fix1 = seedIssue(1, "TODO");
    long fix2 = seedIssue(2, "DONE");
    long aff = seedIssue(3, "TODO");
    link(fix1, v, "FIX");
    link(fix2, v, "FIX");
    link(aff, v, "AFFECTS");
    // 같은 이슈가 두 종류로 붙은 경우도 종류마다 한 건.
    link(fix1, v, "AFFECTS");

    call(delete(base + "/" + v), ownerId).andExpect(status().isNoContent());

    assertThat(dsl.fetchCount(dsl.selectOne().from("issue_version").where("version_id = " + v)))
        .isZero();
    assertThat(dsl.fetchCount(dsl.selectOne().from("project_version").where("id = " + v))).isZero();
    for (long i : new long[] {fix1, fix2}) {
      List<JsonNode> h = history(i, "FIX_VERSIONS_CHANGED");
      assertThat(h).hasSize(1);
      assertThat(h.get(0).get("removed").get(0).get("name").asText()).isEqualTo("1.0");
      assertThat(h.get(0).get("added")).isEmpty();
    }
    assertThat(history(aff, "AFFECTS_VERSIONS_CHANGED")).hasSize(1);
    assertThat(history(aff, "FIX_VERSIONS_CHANGED")).isEmpty();
    assertThat(history(fix1, "AFFECTS_VERSIONS_CHANGED")).hasSize(1);
    assertThat(history(fix2, "AFFECTS_VERSIONS_CHANGED")).isEmpty();
  }

  /** moveTo 가 있으면 수정은 수정으로, 영향은 영향으로 옮긴다(출시된 대상도 된다). */
  @Test
  void deleteMovesSameKind() throws Exception {
    long a = insertVersion(projectId, "A", null, null, null, ARCHIVED_AT);
    long b = insertVersion(projectId, "B", null, null, "2026-01-01T00:00:00Z", null);
    long fix = seedIssue(1, "DONE");
    long aff = seedIssue(2, "TODO");
    link(fix, a, "FIX");
    link(aff, a, "AFFECTS");

    call(delete(base + "/" + a + "?moveTo=" + b), ownerId).andExpect(status().isNoContent());

    assertThat(versionIds(fix, "FIX")).containsExactly(b);
    assertThat(versionIds(fix, "AFFECTS")).isEmpty();
    assertThat(versionIds(aff, "AFFECTS")).containsExactly(b);
    assertThat(versionIds(aff, "FIX")).isEmpty();
    JsonNode h = history(fix, "FIX_VERSIONS_CHANGED").get(0);
    assertThat(h.get("added").get(0).get("id").asLong()).isEqualTo(b);
    assertThat(h.get("removed").get(0).get("id").asLong()).isEqualTo(a);
    assertThat(history(aff, "AFFECTS_VERSIONS_CHANGED")).hasSize(1);
  }

  /** 보관된·자기 자신 대상은 400 VERSION_MOVE_TARGET_INVALID 이고 아무것도 지워지지 않는다. */
  @Test
  void deleteMoveTargetValidated() throws Exception {
    long a = insertVersion(projectId, "A", null, null, null, ARCHIVED_AT);
    long other = insertVersion(projectId, "B", null, null, null, ARCHIVED_AT);
    long issue = seedIssue(1, "TODO");
    link(issue, a, "FIX");

    for (long target : new long[] {other, a}) {
      call(delete(base + "/" + a + "?moveTo=" + target), ownerId)
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.code").value("VERSION_MOVE_TARGET_INVALID"));
    }
    assertThat(versionIds(issue, "FIX")).containsExactly(a);
    assertThat(history(issue, "FIX_VERSIONS_CHANGED")).isEmpty();
  }

  /** 삭제 확인창용 이슈 수 — 수정·영향·끝나지 않은 수정(삭제된 이슈 제외). */
  @Test
  void issueCountBeforeDelete() throws Exception {
    long v = insertVersion(projectId, "A", null, null, null, ARCHIVED_AT);
    long todo = seedIssue(1, "TODO");
    long done = seedIssue(2, "DONE");
    long canceled = seedIssue(3, "CANCELED");
    long aff = seedIssue(4, "TODO");
    long gone = seedIssue(5, "TODO");
    for (long i : new long[] {todo, done, canceled, gone}) link(i, v, "FIX");
    link(aff, v, "AFFECTS");
    dsl.execute("UPDATE issue SET deleted_at = now() WHERE id = ?", gone);

    call(get(base + "/" + v + "/issue-count"), memberId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.fix").value(3))
        .andExpect(jsonPath("$.affects").value(1))
        .andExpect(jsonPath("$.unresolvedFix").value(1));
  }
}
