package com.workplace.version;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.global.tenant.TenantContext;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-888 버전 출시·출시 취소 — 출시일 기본값(기존 → 오늘 Asia/Seoul), 끝나지 않은 수정 버전 이슈 옮기기(완료·취소 제외, 영향 버전 불변, 이력 1건),
 * 옮길 대상 검증(자기 자신·출시됨·보관됨·다른 프로젝트 → 400, 아무것도 안 바뀜), 권한.
 *
 * <p>@Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다.
 */
@Transactional
class VersionReleaseTest extends VersionOpsTestSupport {

  private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    seedProject();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 출시일도 기존 값도 없으면 오늘(Asia/Seoul)로, 출시 시각이 채워진다. */
  @Test
  void releaseSetsStatusAndDate() throws Exception {
    long v = version("1.0");
    LocalDate before = LocalDate.now(SEOUL);
    JsonNode res = json(release(v, null, null).andExpect(status().isOk()));
    LocalDate after = LocalDate.now(SEOUL);

    assertThat(res.get("status").asText()).isEqualTo("RELEASED");
    assertThat(res.get("releasedAt").isNull()).isFalse();
    // 자정을 넘기는 순간에도 결정적이도록 호출 전후의 오늘 중 하나와 맞는지 본다.
    assertThat(LocalDate.parse(res.get("releaseDate").asText())).isIn(before, after);
  }

  /** 출시일을 주지 않으면 기존 출시 예정일을 그대로 쓰고, 주면 그 값으로 바꾼다. */
  @Test
  void releaseKeepsExistingDate() throws Exception {
    long v = insertVersion(projectId, "1.0", null, "2026-01-15", null, null);
    release(v, null, null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.releaseDate").value("2026-01-15"));

    long w = insertVersion(projectId, "1.1", null, "2026-01-15", null, null);
    release(w, "2026-02-01", null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.releaseDate").value("2026-02-01"));
  }

  /** 출시일이 시작일보다 앞서면 400 — 기본값(오늘)이 미래 시작일보다 앞서는 경우도 같다. 출시되지 않는다. */
  @Test
  void releaseRejectsDateBeforeStart() throws Exception {
    long v = insertVersion(projectId, "1.0", "2999-01-01", null, null, null);
    release(v, null, null)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_INVALID_DATES"));
    release(v, "2998-12-31", null)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_INVALID_DATES"));
    assertThat(dsl.fetchValue("SELECT released_at FROM project_version WHERE id = ?", v)).isNull();
  }

  /** 끝나지 않은(할 일·진행 중) 수정 버전 이슈만 옮긴다 — 완료·취소와 영향 버전은 그대로, 옮긴 이슈마다 이력 1건. */
  @Test
  void releaseMovesOnlyUnresolvedFix() throws Exception {
    long v = version("1.0");
    long next = version("1.1");
    long todo = seedIssue(1, "TODO");
    long doing = seedIssue(2, "IN_PROGRESS");
    long done = seedIssue(3, "DONE");
    long canceled = seedIssue(4, "CANCELED");
    long affected = seedIssue(5, "TODO");
    for (long i : new long[] {todo, doing, done, canceled}) link(i, v, "FIX");
    link(affected, v, "AFFECTS");

    release(v, null, next).andExpect(status().isOk());

    for (long i : new long[] {todo, doing}) {
      assertThat(versionIds(i, "FIX")).containsExactly(next);
      List<JsonNode> h = history(i, "FIX_VERSIONS_CHANGED");
      assertThat(h).hasSize(1);
      assertThat(h.get(0).get("added").get(0).get("id").asLong()).isEqualTo(next);
      assertThat(h.get(0).get("removed").get(0).get("id").asLong()).isEqualTo(v);
    }
    for (long i : new long[] {done, canceled}) {
      assertThat(versionIds(i, "FIX")).containsExactly(v);
      assertThat(history(i, "FIX_VERSIONS_CHANGED")).isEmpty();
    }
    assertThat(versionIds(affected, "AFFECTS")).containsExactly(v);
    assertThat(history(affected, "AFFECTS_VERSIONS_CHANGED")).isEmpty();
  }

  /** 대상 버전이 이미 붙은 이슈는 원래 버전만 빠지고 대상 행은 하나로 남는다. */
  @Test
  void releaseMoveSkipsAlreadyTargeted() throws Exception {
    long v = version("1.0");
    long next = version("1.1");
    long issue = seedIssue(1, "TODO");
    link(issue, v, "FIX");
    link(issue, next, "FIX");

    release(v, null, next).andExpect(status().isOk());

    assertThat(versionIds(issue, "FIX")).containsExactly(next);
    List<JsonNode> h = history(issue, "FIX_VERSIONS_CHANGED");
    assertThat(h).hasSize(1);
    assertThat(h.get(0).get("added")).isEmpty();
    assertThat(h.get(0).get("removed").get(0).get("id").asLong()).isEqualTo(v);
  }

  /** 자기 자신·출시된·보관된·다른 프로젝트 대상은 400 이고, 출시도 이슈도 바뀌지 않는다. */
  @Test
  void moveTargetValidated() throws Exception {
    long v = version("1.0");
    long released = insertVersion(projectId, "R", null, null, "2026-01-01T00:00:00Z", null);
    long archived = insertVersion(projectId, "A", null, null, null, "2026-01-01T00:00:00Z");
    long otherProject =
        projectService
            .create(
                ownerId,
                new com.workplace.project.dto.CreateProjectRequest(
                    "O" + key.substring(2), "다른", "x", "OPEN"))
            .id();
    long foreign = insertVersion(otherProject, "F", null, null, null, null);
    long issue = seedIssue(1, "TODO");
    link(issue, v, "FIX");

    for (long target : new long[] {v, released, archived, foreign}) {
      release(v, null, target)
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.code").value("VERSION_MOVE_TARGET_INVALID"));
    }
    assertThat(dsl.fetchValue("SELECT released_at FROM project_version WHERE id = ?", v) == null)
        .isTrue();
    assertThat(versionIds(issue, "FIX")).containsExactly(v);
    assertThat(history(issue, "FIX_VERSIONS_CHANGED")).isEmpty();
  }

  /** 보관된 버전은 출시할 수 없다 — 400 VERSION_ARCHIVED, 출시 시각도 이슈 옮기기도 일어나지 않는다. */
  @Test
  void releaseRejectsArchivedSource() throws Exception {
    long a = insertVersion(projectId, "A", null, null, null, "2026-01-01T00:00:00Z");
    long dest = version("2.0");
    long issue = seedIssue(1, "TODO");
    link(issue, a, "FIX");

    release(a, null, dest)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_ARCHIVED"));
    assertThat(dsl.fetchValue("SELECT released_at FROM project_version WHERE id = ?", a)).isNull();
    assertThat(versionIds(issue, "FIX")).containsExactly(a);
    assertThat(history(issue, "FIX_VERSIONS_CHANGED")).isEmpty();
  }

  /** 출시 취소는 출시 시각만 지우고 출시일은 남긴다. */
  @Test
  void unreleaseKeepsReleaseDate() throws Exception {
    long v = insertVersion(projectId, "1.0", null, "2026-03-01", "2026-03-01T00:00:00Z", null);
    call(post(base + "/" + v + "/unrelease"), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("UNRELEASED"))
        .andExpect(jsonPath("$.releaseDate").value("2026-03-01"))
        .andExpect(jsonPath("$.releasedAt").doesNotExist());
  }

  /** 일반 멤버는 출시·출시 취소를 못 한다. */
  @Test
  void memberCannotRelease() throws Exception {
    long v = version("1.0");
    call(post(base + "/" + v + "/release").content("{}"), memberId)
        .andExpect(status().isForbidden());
    call(post(base + "/" + v + "/unrelease"), memberId).andExpect(status().isForbidden());
  }

  /** POST /{id}/release — null 인 값은 보내지 않는다. */
  private org.springframework.test.web.servlet.ResultActions release(
      long id, String releaseDate, Long moveTo) throws Exception {
    var body = new LinkedHashMap<String, Object>();
    if (releaseDate != null) body.put("releaseDate", releaseDate);
    if (moveTo != null) body.put("moveUnresolvedTo", moveTo);
    return call(post(base + "/" + id + "/release").content(om.writeValueAsString(body)), ownerId);
  }
}
