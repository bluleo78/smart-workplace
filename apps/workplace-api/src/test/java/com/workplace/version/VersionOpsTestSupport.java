package com.workplace.version;

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
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 버전 출시·삭제(WP-888) 통합 테스트 공용 헬퍼 — 프로젝트(OWNER·멤버)·이슈·버전 시드와 연결·이력 조회, MockMvc 호출을 준다. 트랜잭션 여부는 하위
 * 클래스가 정한다(경합 테스트는 커밋이 필요해 트랜잭션 없이 쓴다).
 */
abstract class VersionOpsTestSupport extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;

  long ownerId;
  long memberId;
  String key;
  long projectId;
  String base;

  /** OPEN 프로젝트 하나와 OWNER·멤버를 만든다. 호출 스레드에 테넌트 문맥이 있어야 한다. */
  void seedProject() {
    ownerId = human();
    memberId = human();
    key = "VR" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId =
        projectService.create(ownerId, new CreateProjectRequest(key, "버전", "x", "OPEN")).id();
    projectService.addMember(ownerId, key, new AddMemberRequest(memberId, "MEMBER"));
    base = "/api/v1/projects/" + key + "/versions";
  }

  /** USER 역할의 활성 사람 계정. */
  long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  /** 이슈 시드 — status 는 상태 범주(TODO 가 기본). */
  long seedIssue(long project, int number, String status) {
    long id =
        IssueSeeds.insert(
                issueRepository, dsl, project, number, "이슈" + number, null, "MID", null, ownerId)
            .id();
    if (!"TODO".equals(status)) {
      IssueSeeds.updateAll(
          issueRepository, dsl, id, "이슈" + number, null, status, "MID", null, null, null, null);
    }
    return id;
  }

  long seedIssue(int number, String status) {
    return seedIssue(projectId, number, status);
  }

  /** 버전 시드 — 날짜·출시·보관 시각을 마음대로 준다(문자열, null 허용). */
  long insertVersion(
      long project,
      String name,
      String startDate,
      String releaseDate,
      String releasedAt,
      String archivedAt) {
    return dsl.fetchOne(
            "INSERT INTO project_version (project_id, name, start_date, release_date, released_at,"
                + " archived_at) VALUES (?, ?, ?::date, ?::date, ?::timestamptz, ?::timestamptz)"
                + " RETURNING id",
            project,
            name,
            startDate,
            releaseDate,
            releasedAt,
            archivedAt)
        .get(0, Long.class);
  }

  /** 이 프로젝트의 미출시 버전. */
  long version(String name) {
    return insertVersion(projectId, name, null, null, null, null);
  }

  void link(long issueId, long versionId, String kind) {
    dsl.execute(
        "INSERT INTO issue_version (issue_id, version_id, kind) VALUES (?, ?, ?)",
        issueId,
        versionId,
        kind);
  }

  /** 이슈의 한 종류 버전 id(오름차순). */
  List<Long> versionIds(long issueId, String kind) {
    return dsl.fetch(
            "SELECT version_id FROM issue_version WHERE issue_id = ? AND kind = ? ORDER BY"
                + " version_id",
            issueId,
            kind)
        .getValues(0, Long.class);
  }

  /** 이슈의 한 유형 이력 payload 목록(기록 순). */
  List<JsonNode> history(long issueId, String eventType) {
    return dsl
        .fetch(
            "SELECT to_value FROM issue_history WHERE issue_id = ? AND event_type = ? ORDER BY id",
            issueId,
            eventType)
        .stream()
        .map(
            r -> {
              try {
                return om.readTree(r.get("to_value", String.class));
              } catch (Exception e) {
                throw new IllegalStateException(e);
              }
            })
        .toList();
  }

  ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    // 요청 처리가 지우는 테넌트 문맥을 다시 심는다.
    TenantContext.set(1L);
    return r;
  }

  JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
