package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.USER;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * 이슈 가져오기(WP-883·884) 통합 테스트 공통 준비·호출 — 관리자·소유자·보고자와 팀 프로젝트 시드, 사용자 이름 조회, 최소 요청 본문, 인증을 붙인 가져오기
 * 호출(MockMvc), 응답 번호 읽기를 한 곳에 둔다. 테스트마다 같은 도우미를 복사해 두면 규칙(예: 테넌트 재설정)이 어긋나기 쉬워서다. 트랜잭션 여부는 하위 클래스가
 * 정한다(경합 테스트는 실제 커밋이 필요하다).
 */
abstract class IssueImportTestSupport extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;

  /** 이 테스트가 만든 사람 — 커밋하는 테스트가 끝에 지울 수 있게 모아 둔다. */
  final List<Long> users = new ArrayList<>();

  long admin;
  long owner;
  long reporter;
  String key;
  long projectId;

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /**
   * 테넌트 1 에 ADMIN 역할의 사람(admin)·프로젝트 소유자(owner)·보고자(reporter, 멤버)를 만들고, keyPrefix 로 시작하는 팀 프로젝트를
   * 만든다. 멤버가 더 필요하면 {@link #member()} 로 덧붙인다.
   */
  void seedProject(String keyPrefix, String projectName) {
    TenantContext.set(1L);
    admin = human();
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    owner = human();
    reporter = human();
    key = keyPrefix + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId = projectService.create(owner, new CreateProjectRequest(key, projectName, "x")).id();
    memberRepository.insert(projectId, reporter, "MEMBER");
  }

  /** 현재 테넌트의 활성 구성원인 사람 한 명. */
  long human() {
    long id = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    users.add(id);
    return id;
  }

  /** 시드한 프로젝트의 멤버인 사람 한 명 더. */
  long member() {
    long id = human();
    memberRepository.insert(projectId, id, "MEMBER");
    return id;
  }

  String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.USERNAME);
  }

  /** 최소 요청 본문의 생성 시각 — 테스트 클래스마다 기준 시각이 달라 덮어쓸 수 있게 둔다. */
  String defaultCreatedAt() {
    return "2026-06-10T09:00:00+09:00";
  }

  /** 최소 요청 본문 — 제목·보고자·생성 시각. 테스트마다 덧붙인다. */
  Map<String, Object> body(String title) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("title", title);
    m.put("reporter", username(reporter));
    m.put("createdAt", defaultCreatedAt());
    return m;
  }

  /**
   * callerId 로 인증해(issue:write 권한 포함 — 인터셉터를 통과시켜 서비스의 관리자 판정을 보게) 가져오기를 부른다. 요청 처리가 테넌트 문맥을 지우므로
   * 앞뒤로 다시 심는다.
   */
  ResultActions importAs(long callerId, String projectKey, Map<String, Object> body)
      throws Exception {
    TenantContext.set(1L);
    var auth =
        new UsernamePasswordAuthenticationToken(
            callerId, "n/a", List.of(new SimpleGrantedAuthority("issue:write")));
    ResultActions r =
        mvc.perform(
            post("/api/v1/projects/" + projectKey + "/import/issues")
                .with(authentication(auth))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    TenantContext.set(1L);
    return r;
  }

  ResultActions importAs(long callerId, Map<String, Object> body) throws Exception {
    return importAs(callerId, key, body);
  }

  /** 가져오기 응답 본문의 이슈 번호. */
  int numberOf(ResultActions r) throws Exception {
    JsonNode json = objectMapper.readTree(r.andReturn().getResponse().getContentAsString());
    return json.get("number").asInt();
  }

  /** 시드한 프로젝트의 그 번호 이슈 id(삭제 포함). */
  long issueId(int number) {
    return dsl.select(ISSUE.ID)
        .from(ISSUE)
        .where(ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.NUMBER.eq(number)))
        .fetchOne(ISSUE.ID);
  }

  static OffsetDateTime t(String s) {
    return OffsetDateTime.parse(s);
  }
}
