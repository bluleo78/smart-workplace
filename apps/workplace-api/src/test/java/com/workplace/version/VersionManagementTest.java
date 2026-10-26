package com.workplace.version;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.version.dto.VersionSummary;
import com.workplace.version.repository.VersionRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-888 버전 목록 관리 API — 목록 순서, 권한(OWNER·ADMIN·멤버·비멤버), 이름 유일(대소문자·공백), 날짜 검증, 개인 프로젝트 거부, 보관·복원, 진행
 * 집계(수정 버전만, 취소는 완료), 개수 상한.
 *
 * <p>@Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다.
 */
@Transactional
class VersionManagementTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired VersionRepository versionRepository;

  private long ownerId;
  private long memberId;
  private long outsiderId;
  private long adminId;
  private String key;
  private long projectId;
  private String base;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human("USER");
    memberId = human("USER");
    outsiderId = human("USER");
    adminId = human("ADMIN");
    key = "VM" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    // OPEN 프로젝트 — 비멤버도 읽을 수 있어 「읽기 가능한 비멤버」 케이스를 같은 프로젝트에서 본다.
    projectId =
        projectService.create(ownerId, new CreateProjectRequest(key, "버전", "x", "OPEN")).id();
    projectService.addMember(ownerId, key, new AddMemberRequest(memberId, "MEMBER"));
    base = "/api/v1/projects/" + key + "/versions";
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 미출시(출시일 오름차순·없음 뒤) → 출시됨(출시일 내림차순) → 보관. */
  @Test
  void listOrder() throws Exception {
    insertVersion("A", "2026-11-10", null, null);
    insertVersion("B", "2026-11-01", null, null);
    insertVersion("C", null, null, null);
    insertVersion("D", "2026-10-01", "2026-10-01T00:00:00Z", null);
    insertVersion("E", "2026-10-15", "2026-10-15T00:00:00Z", null);
    insertVersion("F", "2026-09-01", null, "2026-10-20T00:00:00Z");

    JsonNode list = json(call(get(base), ownerId).andExpect(status().isOk()));
    List<String> names = new ArrayList<>();
    list.forEach(n -> names.add(n.get("name").asText()));
    assertThat(names).containsExactly("B", "A", "C", "E", "D", "F");
    assertThat(list.get(0).get("status").asText()).isEqualTo("UNRELEASED");
    assertThat(list.get(3).get("status").asText()).isEqualTo("RELEASED");
    assertThat(list.get(5).get("status").asText()).isEqualTo("ARCHIVED");
  }

  /** 테넌트 ADMIN(비멤버)은 관리할 수 있고, 일반 멤버는 403, 읽을 수 있는 비멤버는 목록만 본다. */
  @Test
  void adminCanManageMemberCannot() throws Exception {
    call(post(base).content(body("ByAdmin", null, null, null)), adminId)
        .andExpect(status().isCreated());
    call(post(base).content(body("ByMember", null, null, null)), memberId)
        .andExpect(status().isForbidden());
    call(get(base), outsiderId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(1));

    long id = createVersion("Target");
    call(patch(base + "/" + id).content("{\"name\":\"X\"}"), memberId)
        .andExpect(status().isForbidden());
    call(patch(base + "/" + id).content("{\"description\":\"d\"}"), adminId)
        .andExpect(status().isOk());
    call(get(base + "/" + id), outsiderId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("Target"));
  }

  /** 이름은 대소문자·앞뒤 공백을 무시하고 유일, 41자는 거절. */
  @Test
  void nameUniqueIgnoringCase() throws Exception {
    createVersion("v1.6.1");
    call(post(base).content(body(" V1.6.1 ", null, null, null)), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_NAME_TAKEN"));

    long other = createVersion("Other");
    call(patch(base + "/" + other).content("{\"name\":\" V1.6.1 \"}"), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_NAME_TAKEN"));
    // 자기 이름의 대소문자만 바꾸는 것은 허용된다.
    call(patch(base + "/" + other).content("{\"name\":\"OTHER\"}"), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("OTHER"));

    call(post(base).content(body("x".repeat(41), null, null, null)), ownerId)
        .andExpect(status().isBadRequest());
  }

  /** 시작일 > 출시일은 생성·수정 모두 거절, 수정은 기존 값과 합쳐 검사한다. */
  @Test
  void datesValidated() throws Exception {
    call(post(base).content(body("Bad", null, "2026-12-02", "2026-12-01")), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_INVALID_DATES"));

    long id =
        json(call(post(base).content(body("Good", null, "2026-12-01", "2026-12-31")), ownerId)
                .andExpect(status().isCreated()))
            .get("id")
            .asLong();
    // 출시일만 보내도 기존 시작일과 합쳐 본다.
    call(patch(base + "/" + id).content("{\"releaseDate\":\"2026-11-30\"}"), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_INVALID_DATES"));
    call(patch(base + "/" + id).content("{\"startDate\":\"2027-01-01\"}"), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_INVALID_DATES"));
    // 시작일을 지우면서 출시일을 앞당기는 것은 된다.
    call(
            patch(base + "/" + id)
                .content("{\"clearStartDate\":true,\"releaseDate\":\"2026-11-30\"}"),
            ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.startDate").doesNotExist())
        .andExpect(jsonPath("$.releaseDate").value("2026-11-30"));
  }

  /** 개인 프로젝트에는 만들 수 없다. */
  @Test
  void personalProjectRejected() throws Exception {
    dsl.execute("UPDATE project SET type = 'PERSONAL' WHERE id = ?", projectId);
    call(post(base).content(body("Any", null, null, null)), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("PERSONAL_PROJECT_UNSUPPORTED"));
  }

  /** 보관은 출시 상태를 건드리지 않아, 복원하면 미출시/출시됨으로 돌아간다. */
  @Test
  void archiveAndRestore() throws Exception {
    long unreleased = createVersion("U");
    long released = insertVersion("R", null, "2026-10-01T00:00:00Z", null);

    for (long id : new long[] {unreleased, released}) {
      call(patch(base + "/" + id).content("{\"archived\":true}"), ownerId)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.status").value("ARCHIVED"));
    }
    call(patch(base + "/" + unreleased).content("{\"archived\":false}"), ownerId)
        .andExpect(jsonPath("$.status").value("UNRELEASED"));
    call(patch(base + "/" + released).content("{\"archived\":false}"), ownerId)
        .andExpect(jsonPath("$.status").value("RELEASED"))
        .andExpect(jsonPath("$.releasedAt").exists());
  }

  /** 진행은 수정 버전만 센다 — 취소는 완료, 영향 버전은 affectsCount 로만. */
  @Test
  void progressCountsFixOnlyCanceledAsDone() throws Exception {
    long v = createVersion("P");
    long other = createVersion("Q");
    String[] statuses = {"DONE", "CANCELED", "IN_PROGRESS", "TODO"};
    for (int i = 0; i < statuses.length; i++) {
      long issue = seedIssue(i + 1, statuses[i]);
      link(issue, v, "FIX");
    }
    // 같은 이슈가 다른 버전의 수정 버전이기도 해도 각각 따로 센다.
    long extra1 = seedIssue(10, "TODO");
    long extra2 = seedIssue(11, "CANCELED");
    link(extra1, v, "AFFECTS");
    link(extra2, v, "AFFECTS");
    link(extra1, other, "FIX");
    // 삭제된 이슈는 세지 않는다.
    long deleted = seedIssue(12, "DONE");
    link(deleted, v, "FIX");
    dsl.execute("UPDATE issue SET deleted_at = now() WHERE id = ?", deleted);

    JsonNode list = json(call(get(base), ownerId));
    JsonNode p = null;
    JsonNode q = null;
    for (JsonNode n : list) {
      if (n.get("name").asText().equals("P")) p = n;
      if (n.get("name").asText().equals("Q")) q = n;
    }
    assertThat(p.get("progress").get("done").asInt()).isEqualTo(2);
    assertThat(p.get("progress").get("inProgress").asInt()).isEqualTo(1);
    assertThat(p.get("progress").get("todo").asInt()).isEqualTo(1);
    assertThat(p.get("affectsCount").asInt()).isEqualTo(2);
    assertThat(q.get("progress").get("todo").asInt()).isEqualTo(1);
    assertThat(q.get("affectsCount").asInt()).isZero();
    assertThat(v).isEqualTo(p.get("id").asLong());
  }

  /** 프로젝트당 200개까지 — 201번째는 거절. */
  @Test
  void limit200() throws Exception {
    for (int i = 0; i < 200; i++) {
      dsl.execute(
          "INSERT INTO project_version (project_id, name) VALUES (?, ?)", projectId, "V" + i);
    }
    call(post(base).content(body("OneMore", null, null, null)), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("VERSION_LIMIT"));
  }

  /** 이후 작업이 쓰는 조회 — 이름 검색(대소문자 무시·보관 포함), 이슈별 요약(종류별·목록 순서), 공유·배타 잠금. */
  @Test
  void repositoryLookups() throws Exception {
    long late = insertVersion("late", "2026-12-01", null, null);
    long early = insertVersion("Early", "2026-11-01", null, null);
    long arch = insertVersion("old", null, null, "2026-10-01T00:00:00Z");
    long issue = seedIssue(1, "TODO");
    link(issue, late, "FIX");
    link(issue, early, "FIX");
    link(issue, arch, "AFFECTS");

    assertThat(versionRepository.findByNamesIgnoreCase(projectId, List.of("EARLY", "OLD")))
        .extracting(r -> r.id())
        .containsExactly(early, arch);
    assertThat(versionRepository.findByIds(projectId, List.of(late, 999_999L)))
        .extracting(r -> r.id())
        .containsExactly(late);
    var both = versionRepository.summariesByIssueIdsBothKinds(List.of(issue, 999_999L));
    assertThat(both.keySet()).containsExactly(issue);
    assertThat(both.get(issue).fix())
        .extracting(VersionSummary::name)
        .containsExactly("Early", "late");
    assertThat(both.get(issue).affects())
        .extracting(s -> s.name() + ":" + s.status())
        .containsExactly("old:ARCHIVED");
    assertThat(versionRepository.lockByIds(List.of(late, early), VersionRepository.LockMode.SHARE))
        .extracting(r -> r.id())
        .containsExactlyInAnyOrder(late, early);
    assertThat(versionRepository.lockByIds(List.of(late), VersionRepository.LockMode.UPDATE))
        .hasSize(1);
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────────────────

  private long human(String role) {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, role);
    return id;
  }

  private long seedIssue(int number, String status) {
    long id =
        IssueSeeds.insert(
                issueRepository, dsl, projectId, number, "이슈" + number, null, "MID", null, ownerId)
            .id();
    // issue.status 는 상태 범주 — 진행 집계가 읽는 값을 범주 기본 상태로 맞춘다.
    if (!"TODO".equals(status)) {
      IssueSeeds.updateAll(
          issueRepository, dsl, id, "이슈" + number, null, status, "MID", null, null, null, null);
    }
    return id;
  }

  /** 시드용 직접 삽입 — releaseDate·releasedAt·archivedAt 을 마음대로 준다. */
  private long insertVersion(
      String name, String releaseDate, String releasedAt, String archivedAt) {
    return dsl.fetchOne(
            "INSERT INTO project_version (project_id, name, release_date, released_at, archived_at)"
                + " VALUES (?, ?, ?::date, ?::timestamptz, ?::timestamptz) RETURNING id",
            projectId,
            name,
            releaseDate,
            releasedAt,
            archivedAt)
        .get(0, Long.class);
  }

  private void link(long issueId, long versionId, String kind) {
    dsl.execute(
        "INSERT INTO issue_version (issue_id, version_id, kind) VALUES (?, ?, ?)",
        issueId,
        versionId,
        kind);
  }

  private long createVersion(String name) throws Exception {
    return json(call(post(base).content(body(name, null, null, null)), ownerId)
            .andExpect(status().isCreated()))
        .get("id")
        .asLong();
  }

  private String body(String name, String description, String start, String release)
      throws Exception {
    var m = new java.util.LinkedHashMap<String, Object>();
    m.put("name", name);
    m.put("description", description);
    m.put("startDate", start);
    m.put("releaseDate", release);
    return om.writeValueAsString(m);
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    // 요청 처리가 지우는 테넌트 문맥을 다시 심는다.
    TenantContext.set(1L);
    return r;
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
