package com.workplace.issue;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.auth.service.UserApiTokenService;
import com.workplace.global.security.AgentToolContext;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.AgentWorkRepository.AgentWorkRow;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.net.http.HttpClient;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

/**
 * AI 작업 기록(WP-377) 실제 HTTP 통합 테스트 공용 기반. 자동 시작·종료·보고 테스트(Task 4·5·6)가 함께 쓴다.
 *
 * <p>수행 도구 헤더(X-Agent-Tool)는 PAT(swp_)·AI 키(ak_) 인증 필터에서만 읽히므로, MockMvc 가 아닌 실제 HTTP 요청(RANDOM_PORT
 * + RestTemplate)으로 필터를 통과시킨다. 실제 요청은 별도 트랜잭션이라 테스트는 비트랜잭션으로 커밋된 시드를 쓰고 {@code @AfterEach} 에서
 * 정리한다(UserTokenAuthenticationFilterTest·ApiKeyAuthenticationFilterTest 패턴).
 *
 * <p>시드: 프로젝트 1개(사람 소유) + 이슈 1건. 담당자 = 사람(human)·AI 구성원(agent), 비담당 프로젝트 멤버(other). 토큰 = 사람
 * PAT·JWT, 비담당 PAT, AI 구성원 ak_.
 */
public abstract class AgentWorkTestSupport extends IntegrationTestBase {

  protected static final long TENANT_ID = 1L;
  protected static final String TOOL = "claude-code";

  @Autowired protected DSLContext dsl;
  @Autowired protected UserApiTokenService userTokenService;
  @Autowired protected AgentApiKeyService agentKeyService;
  @Autowired protected JwtTokenProvider jwtTokenProvider;
  @Autowired protected ProjectService projectService;
  @Autowired protected ProjectMemberRepository projectMemberRepository;
  @Autowired protected IssueService issueService;
  @Autowired protected IssueAssigneeRepository issueAssigneeRepository;
  @Autowired protected AgentWorkRepository agentWorkRepository;

  @LocalServerPort private int port;

  // PATCH 를 지원하는 JDK 클라이언트(HTTP/1.1 고정 — 평문 h2c 업그레이드 헤더를 피한다). 기본 팩토리(HttpURLConnection)는 PATCH
  // 불가.
  private final RestTemplate rest =
      new RestTemplate(
          new JdkClientHttpRequestFactory(
              HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()));

  /** 정리 대상 사용자 — 시드 순서대로 쌓는다. */
  private final List<Long> userIds = new ArrayList<>();

  protected long humanId;
  protected long agentId;
  protected long otherId;
  protected long projectId;
  protected String projectKey;
  protected long issueId;
  protected int issueNumber;

  /** 사람 담당자 PAT(Bearer 포함). */
  protected String patToken;

  /** 비담당 프로젝트 멤버 PAT(Bearer 포함). */
  protected String otherPatToken;

  /** AI 구성원 담당자 ak_ 키(Bearer 포함). */
  protected String akToken;

  /** 사람 담당자 브라우저 JWT(테넌트 클레임 포함, Bearer 포함). */
  protected String jwtToken;

  /** 사용자·프로젝트·이슈·토큰을 시드한다. 서비스 호출은 요청 밖이라 TenantContext 를 직접 잡는다. */
  @BeforeEach
  void seedAgentWorkFixture() {
    humanId = createHuman("aw-human");
    otherId = createHuman("aw-other");
    agentId = withMembership(createAgentUser("aw-agent"));
    userIds.add(agentId);

    TenantContext.set(TENANT_ID);
    try {
      String suffix =
          UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
      var project =
          projectService.create(humanId, new CreateProjectRequest("AW" + suffix, "P-aw", "x"));
      projectId = project.id();
      projectKey = project.key();
      // 프로젝트 생성 시 소유자(human)는 자동 멤버 — AI 구성원·비담당 사람만 추가한다.
      projectMemberRepository.insert(projectId, agentId, "MEMBER");
      projectMemberRepository.insert(projectId, otherId, "MEMBER");
      var issue =
          issueService.create(
              humanId,
              projectKey,
              new CreateIssueRequest("AI 작업 대상", "본문", "MID", null, List.of(), null, null, null));
      issueId = issue.id();
      issueNumber = issue.number();
      // 담당자 직접 시드 — 배정 이벤트(ai-agent 발사 후보)를 일으키지 않게 저장소로 넣는다.
      issueAssigneeRepository.add(issueId, humanId, humanId);
      issueAssigneeRepository.add(issueId, agentId, humanId);

      patToken =
          "Bearer "
              + userTokenService
                  .issue(humanId, new IssueUserTokenRequest("aw", null))
                  .plaintextToken();
      otherPatToken =
          "Bearer "
              + userTokenService
                  .issue(otherId, new IssueUserTokenRequest("aw", null))
                  .plaintextToken();
      akToken =
          "Bearer "
              + agentKeyService
                  .issue(humanId, agentId, new IssueAgentKeyRequest("aw"))
                  .plaintextKey();
      jwtToken =
          "Bearer "
              + jwtTokenProvider.generateAccessToken(humanId, "aw-human-" + humanId, TENANT_ID);
    } finally {
      TenantContext.clear();
    }
  }

  /** 시드 역순 정리: 작업 기록 → 이슈(코멘트·알림·담당자 CASCADE) → 프로젝트 → 감사 로그 → 사용자. */
  @AfterEach
  void cleanupAgentWorkFixture() {
    cleanupInTenant(
        TENANT_ID,
        () -> {
          if (!userIds.isEmpty()) {
            dsl.deleteFrom(AGENT_WORK).where(AGENT_WORK.WORKER_ID.in(userIds)).execute();
          }
          if (projectId != 0) {
            dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)).execute();
          }
          if (!userIds.isEmpty()) {
            // PAT 로 GET /projects 를 부르면 개인 프로젝트가 지연 생성될 수 있어 소유 프로젝트를 모두 지운다.
            dsl.deleteFrom(ISSUE)
                .where(
                    ISSUE.PROJECT_ID.in(
                        dsl.select(PROJECT.ID).from(PROJECT).where(PROJECT.OWNER_ID.in(userIds))))
                .execute();
            dsl.deleteFrom(PROJECT).where(PROJECT.OWNER_ID.in(userIds)).execute();
            dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
          }
        });
    if (!userIds.isEmpty()) {
      // ak_ 키는 발급자(created_by, 사람)도 참조해 CASCADE 순서가 엇갈리므로 먼저 지운다.
      // membership·user_role·PAT 는 user 삭제 시 CASCADE.
      dsl.deleteFrom(AGENT_API_KEY).where(AGENT_API_KEY.USER_ID.in(userIds)).execute();
      dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
    }
    userIds.clear();
    projectId = 0;
  }

  /** USER 역할 + 테넌트#1 ACTIVE 멤버십을 가진 사람 사용자(UserTokenAuthenticationFilterTest 시드와 같음). */
  private long createHuman(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    userIds.add(id);
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, TENANT_ID)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  // ---------------------------------------------------------------- HTTP

  /** 실제 HTTP 요청. tool 이 null 이 아니면 X-Agent-Tool 헤더를 싣는다. 4xx/5xx 도 예외 대신 응답으로 돌려준다. */
  protected ResponseEntity<String> call(
      HttpMethod method, String path, String token, Object body, String tool) {
    HttpHeaders headers = new HttpHeaders();
    headers.set("Authorization", token);
    if (tool != null) headers.set(AgentToolContext.HEADER, tool);
    if (body != null) headers.setContentType(MediaType.APPLICATION_JSON);
    try {
      return rest.exchange(
          "http://localhost:" + port + path, method, new HttpEntity<>(body, headers), String.class);
    } catch (HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAsString());
    }
  }

  /** 이슈 경로(/api/v1/projects/{key}/issues/{number}). */
  protected String issuePath() {
    return "/api/v1/projects/" + projectKey + "/issues/" + issueNumber;
  }

  /** 이슈 부분 수정 PATCH. */
  protected ResponseEntity<String> patch(String token, Map<String, ?> body, String tool) {
    return call(HttpMethod.PATCH, issuePath(), token, body, tool);
  }

  /** 이슈 상세 GET. */
  protected ResponseEntity<String> get(String token, String tool) {
    return call(HttpMethod.GET, issuePath(), token, null, tool);
  }

  /** 이슈 코멘트 작성 — MCP add_comment 가 쓰는 POST /api/v1/issues/{issueId}/comments. */
  protected ResponseEntity<String> postComment(String token, String text, String tool) {
    return call(
        HttpMethod.POST,
        "/api/v1/issues/" + issueId + "/comments",
        token,
        Map.of("body", text),
        tool);
  }

  /** 담당자 전체 교체 PUT. */
  protected ResponseEntity<String> putAssignees(String token, List<Long> userIds, String tool) {
    return call(
        HttpMethod.PUT, issuePath() + "/assignees", token, Map.of("userIds", userIds), tool);
  }

  /** AI 작업 명시 보고 PUT. */
  protected ResponseEntity<String> putReport(String token, String tool, Map<String, ?> body) {
    return call(HttpMethod.PUT, issuePath() + "/agent-work", token, body, tool);
  }

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /** 요청이 성공(2xx)했는지 — 거절로 인한 거짓 통과를 막는다. 실패 응답이면 본문을 메시지로 보여준다. */
  protected static void assertOk(ResponseEntity<String> res) {
    assertThat(res.getStatusCode().is2xxSuccessful()).as(res.getBody()).isTrue();
  }

  /** 응답 본문을 JSON 으로 파싱한다. */
  protected static JsonNode json(ResponseEntity<String> res) {
    try {
      return MAPPER.readTree(res.getBody());
    } catch (Exception e) {
      throw new IllegalStateException(res.getBody(), e);
    }
  }

  /** 이슈 챗 스레드를 만들고(없으면) id 를 돌려준다 — 사람 JWT 로 GET. */
  protected long chatThreadId() {
    var res = call(HttpMethod.GET, issuePath() + "/chat/thread", jwtToken, null, null);
    return json(res).get("threadId").asLong();
  }

  /** 이슈 챗 글 작성(사람 JWT 등 지정 토큰). */
  protected ResponseEntity<String> postChat(String token, String text) {
    return call(
        HttpMethod.POST,
        "/api/v1/chat/threads/" + chatThreadId() + "/messages",
        token,
        Map.of("body", text),
        null);
  }

  /** 이슈 챗 마지막 글(작성자 id·질문 표시). 없으면 null. */
  protected ChatRow lastChatMessage(long issueId) {
    var row = lastChatMessageOrNull(issueId);
    assertThat(row).as("이슈 %d 챗에 글이 없다", issueId).isNotNull();
    return row;
  }

  /** 이슈 챗 마지막 글 — 없으면 null. */
  protected ChatRow lastChatMessageOrNull(long issueId) {
    return inTenant(
        () ->
            dsl.select(CHAT_MESSAGE.AUTHOR_ID, CHAT_MESSAGE.IS_QUESTION, CHAT_MESSAGE.BODY)
                .from(CHAT_MESSAGE)
                .join(CHAT_THREAD)
                .on(CHAT_THREAD.ID.eq(CHAT_MESSAGE.THREAD_ID))
                .where(CHAT_THREAD.ISSUE_ID.eq(issueId))
                .orderBy(CHAT_MESSAGE.ID.desc())
                .limit(1)
                .fetchOne(
                    r ->
                        new ChatRow(
                            r.get(CHAT_MESSAGE.AUTHOR_ID),
                            r.get(CHAT_MESSAGE.IS_QUESTION),
                            r.get(CHAT_MESSAGE.BODY))));
  }

  /** 챗 글 조회 결과. */
  protected record ChatRow(long authorId, boolean isQuestion, String body) {}

  /** 이슈 상태. */
  protected String issueStatus() {
    return inTenant(
        () ->
            dsl.select(ISSUE.STATUS)
                .from(ISSUE)
                .where(ISSUE.ID.eq(issueId))
                .fetchOne(ISSUE.STATUS));
  }

  // ---------------------------------------------------------------- DB

  /** 테넌트#1 트랜잭션 안에서 조회·시드한다(agent_work 는 RLS FORCE). */
  protected <T> T inTenant(Supplier<T> body) {
    Long prev = TenantContext.get();
    TenantContext.set(TENANT_ID);
    try {
      return new TransactionTemplate(txManager).execute(status -> body.get());
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** (이슈, 작업자)의 진행 중 작업. */
  protected Optional<AgentWorkRow> activeWork(long issueId, long workerId) {
    return inTenant(() -> agentWorkRepository.findActive(issueId, workerId));
  }

  /** (이슈, 작업자)의 모든 작업 행(진행·종료 포함) 상태를 id 순으로. */
  protected List<String> allStates(long issueId, long workerId) {
    return inTenant(
        () ->
            dsl.select(AGENT_WORK.STATE)
                .from(AGENT_WORK)
                .where(AGENT_WORK.ISSUE_ID.eq(issueId))
                .and(AGENT_WORK.WORKER_ID.eq(workerId))
                .orderBy(AGENT_WORK.ID.asc())
                .fetch(AGENT_WORK.STATE));
  }

  /** (이슈, 작업자)의 작업 행들이 남긴 이벤트 상태를 시간순으로. */
  protected List<String> eventStates(long issueId, long workerId) {
    return inTenant(
        () ->
            dsl.select(AGENT_WORK_EVENT.STATE)
                .from(AGENT_WORK_EVENT)
                .join(AGENT_WORK)
                .on(AGENT_WORK.ID.eq(AGENT_WORK_EVENT.WORK_ID))
                .where(AGENT_WORK.ISSUE_ID.eq(issueId))
                .and(AGENT_WORK.WORKER_ID.eq(workerId))
                .orderBy(AGENT_WORK_EVENT.ID.asc())
                .fetch(AGENT_WORK_EVENT.STATE));
  }

  /** 도구를 모르는 SUBMITTED 작업을 저장소로 직접 만든다(담당자 추가 경로를 거치지 않고 상태만 시드할 때). */
  protected void seedSubmitted(long issueId, long workerId) {
    inTenant(() -> agentWorkRepository.insertOutcome(issueId, workerId, null, "SUBMITTED"));
  }

  /** 워크스페이스 구성원인 AI 를 하나 더 시드한다(정리 대상에 넣는다) — 프로젝트 구성원은 아니다. */
  protected long addAgent(String prefix) {
    long id = createAgentUserWithMembership(prefix);
    userIds.add(id);
    return id;
  }

  /** 프로젝트 구성원인 AI 를 하나 더 시드한다 — AI 가 다른 AI 에게 일을 맡기는 흐름(WP-453)의 받는 쪽. */
  protected long addAgentMember(String prefix) {
    long id = addAgent(prefix);
    inTenant(
        () -> {
          projectMemberRepository.insert(projectId, id, "MEMBER");
          return null;
        });
    return id;
  }

  /** AI 구성원을 외부 실행(EXTERNAL)으로 바꾼다 — 담당자로 들어올 때 "시작 전" 작업이 만들어지는 대상. 기본은 내부 실행(INTERNAL). */
  protected void makeExternal(long agentUserId) {
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(agentUserId)).execute();
  }

  /** 이슈의 진행 중 작업 수. */
  protected int activeCount(long issueId) {
    return inTenant(
        () ->
            dsl.fetchCount(
                AGENT_WORK, AGENT_WORK.ISSUE_ID.eq(issueId).and(AGENT_WORK.ENDED_AT.isNull())));
  }

  /** 진행 중 작업을 지정 상태로 시드한다(기존 진행 중 작업은 종료 — 부분 유니크 때문). */
  protected void seedActive(long issueId, long workerId, String state) {
    seedActive(issueId, workerId, state, OffsetDateTime.now());
  }

  /** 진행 중 작업을 지정 상태·마지막 보고 시각으로 시드한다(무소식 재현용). */
  protected void seedActive(long issueId, long workerId, String state, OffsetDateTime updatedAt) {
    inTenant(
        () -> {
          dsl.update(AGENT_WORK)
              .set(AGENT_WORK.STATE, "CANCELED")
              .set(AGENT_WORK.ENDED_AT, OffsetDateTime.now())
              .where(AGENT_WORK.ISSUE_ID.eq(issueId))
              .and(AGENT_WORK.WORKER_ID.eq(workerId))
              .and(AGENT_WORK.ENDED_AT.isNull())
              .execute();
          return dsl.insertInto(AGENT_WORK)
              .set(AGENT_WORK.ISSUE_ID, issueId)
              .set(AGENT_WORK.WORKER_ID, workerId)
              .set(AGENT_WORK.TOOL, TOOL)
              .set(AGENT_WORK.STATE, state)
              .set(AGENT_WORK.UPDATED_AT, updatedAt)
              .execute();
        });
  }
}
