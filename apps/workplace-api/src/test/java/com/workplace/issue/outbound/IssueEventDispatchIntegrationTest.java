package com.workplace.issue.outbound;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.repository.UserRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 5b-1 통합 테스트 — 실제 서비스 호출 → 이벤트 발행 → AFTER_COMMIT dispatcher → AiAgentEventClient.publish 캡처. 실제
 * HTTP 발사 단위는 AiAgentEventClientTest 에서 검증. 본 클래스는 @Transactional 을 절대 붙이지 않는다 — 외부 트랜잭션이 있으면
 * AFTER_COMMIT 이 발화하지 않기 때문 (위험 1 대응).
 */
@DisplayName("이슈 도메인 이벤트 → ai-agent dispatcher 통합")
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class IssueEventDispatchIntegrationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueAssigneeService assigneeService;
  @Autowired IssueCommentService commentService;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;
  @Autowired UserRepository userRepository;

  @MockitoSpyBean AiAgentEventClient client;

  /**
   * 통합 테스트는 dispatcher → client 호출 캡처만 검증한다. 실제 HTTP 발사는 AiAgentEventClientTest 의
   * MockRestServiceServer 가 담당. spy 가 실제 publish 를 실행하면 ai-agent 가 부재한 환경에서 재시도 백오프(1s+2s+4s ≒ 7s)
   * 가 누적되므로 doNothing 으로 stub.
   */
  // 비-Tx(AFTER_COMMIT 검증, 클래스에 @Transactional 금지) 테스트: 커밋된 row 추적 → @AfterEach 회수.
  private final List<Long> createdUserIds = new ArrayList<>();

  private final List<Long> createdProjectIds = new ArrayList<>();

  @BeforeEach
  void stubClientPublish() {
    doNothing().when(client).publish(any(EventEnvelope.class));
  }

  @AfterEach
  void cleanup() {
    if (!createdProjectIds.isEmpty()) {
      // issue.project_id 는 CASCADE 아님 → issue(자식 CASCADE) 먼저, 그다음 project(member/types CASCADE).
      dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.in(createdProjectIds)).execute();
      dsl.deleteFrom(PROJECT).where(PROJECT.ID.in(createdProjectIds)).execute();
    }
    if (!createdUserIds.isEmpty()) {
      dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(createdUserIds)).execute();
      dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    }
    createdProjectIds.clear();
    createdUserIds.clear();
  }

  /** HUMAN 유저 한 명 생성 + USER 역할 부여. username 은 UUID 접미사로 격리. */
  private Long createHuman(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    createdUserIds.add(id);
    return id;
  }

  /** AGENT 유저 — UserRepository.createAgent 헬퍼 사용 (kind=AGENT, password=NULL). */
  private Long createAgent(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        userRepository
            .createAgent(prefix + "-" + suffix, prefix + "-" + suffix + "@example.com", prefix)
            .id();
    createdUserIds.add(id);
    return id;
  }

  /** key 는 2~10자 대문자/숫자. 충돌 회피 위해 UUID 4자 접미사. */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  /** HUMAN owner + AGENT member 가 있는 프로젝트를 만들고 (humanId, agentId, projectKey) 반환. */
  private record Setup(Long humanId, Long agentId, String projectKey) {}

  private Setup seed() {
    Long human = createHuman("h");
    Long agent = createAgent("a");
    var proj =
        projectService.create(human, new CreateProjectRequest(uniqueKey("WP"), "P-event", "x"));
    createdProjectIds.add(proj.id());
    // 프로젝트 생성 시 owner 자동 등록되므로 agent 만 추가
    memberRepository.insert(proj.id(), agent, "MEMBER");
    return new Setup(human, agent, proj.key());
  }

  @Test
  @DisplayName("AGENT 를 assignee 로 한 이슈 생성 → created + assigned 2회 발사")
  void create_with_agent_assignee_publishes_two() {
    var fx = seed();
    issueService.create(
        fx.humanId(),
        fx.projectKey(),
        new CreateIssueRequest("AI 가 할 일", "본문", "MID", null, List.of(fx.agentId()), null, null));

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(2000).times(2)).publish(captor.capture());
    assertThat(captor.getAllValues())
        .extracting(EventEnvelope::type)
        .containsExactlyInAnyOrder("issue.created", "issue.assigned");
  }

  @Test
  @DisplayName("사람만 assignee 인 이슈 생성 → 발사 0회")
  void create_human_only_publishes_zero() {
    var fx = seed();
    issueService.create(
        fx.humanId(),
        fx.projectKey(),
        new CreateIssueRequest("사람 작업", "본문", "MID", null, List.of(fx.humanId()), null, null));

    // AFTER_COMMIT 비동기 발화 여유 시간 확보 후 0회 검증
    try {
      Thread.sleep(300);
    } catch (InterruptedException ie) {
      Thread.currentThread().interrupt();
    }
    verify(client, never()).publish(org.mockito.Mockito.any());
  }

  @Test
  @DisplayName("기존 이슈에 AGENT 추가 → assigned 1회, added 에 AGENT 포함")
  void assign_agent_to_existing_publishes_assigned() {
    var fx = seed();
    var issue =
        issueService.create(
            fx.humanId(),
            fx.projectKey(),
            new CreateIssueRequest("기존", "본문", "MID", null, List.of(), null, null));
    org.mockito.Mockito.reset(client);
    doNothing().when(client).publish(any(EventEnvelope.class));

    assigneeService.replace(fx.humanId(), fx.projectKey(), issue.number(), List.of(fx.agentId()));

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(2000).times(1)).publish(captor.capture());
    var env = captor.getValue();
    assertThat(env.type()).isEqualTo("issue.assigned");
    @SuppressWarnings("unchecked")
    var added = (List<java.util.Map<String, Object>>) env.payload().get("added");
    assertThat(added).extracting(m -> m.get("id")).contains(fx.agentId());
  }

  @Test
  @DisplayName("AGENT 담당 이슈에 사람이 코멘트 → commented 1회, commentBody 포함")
  void human_comment_on_agent_issue_publishes_commented() {
    var fx = seed();
    var issue =
        issueService.create(
            fx.humanId(),
            fx.projectKey(),
            new CreateIssueRequest("AI 작업", "본문", "MID", null, List.of(fx.agentId()), null, null));
    // setup 단계 비동기 발사 2회(created+assigned) 완료를 기다린 뒤 reset — async 라 reset 너머로 흘러오지 않게.
    verify(client, timeout(2000).times(2)).publish(any(EventEnvelope.class));
    org.mockito.Mockito.reset(client);
    doNothing().when(client).publish(any(EventEnvelope.class));

    commentService.create(fx.humanId(), issue.id(), new CreateCommentRequest("@ai 확인 부탁"));

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(2000).times(1)).publish(captor.capture());
    var env = captor.getValue();
    assertThat(env.type()).isEqualTo("issue.commented");
    assertThat(env.payload()).containsEntry("commentBody", "@ai 확인 부탁");
  }

  @Test
  @DisplayName("AGENT 가 자기 담당 이슈에 코멘트 → self-loop 차단, 발사 0회")
  void agent_self_comment_skipped() {
    var fx = seed();
    var issue =
        issueService.create(
            fx.humanId(),
            fx.projectKey(),
            new CreateIssueRequest("AI 작업", "본문", "MID", null, List.of(fx.agentId()), null, null));
    // setup 단계 비동기 발사 2회 완료 대기 후 reset.
    verify(client, timeout(2000).times(2)).publish(any(EventEnvelope.class));
    org.mockito.Mockito.reset(client);
    doNothing().when(client).publish(any(EventEnvelope.class));

    commentService.create(fx.agentId(), issue.id(), new CreateCommentRequest("작업 완료"));

    try {
      Thread.sleep(300);
    } catch (InterruptedException ie) {
      Thread.currentThread().interrupt();
    }
    verify(client, never()).publish(org.mockito.Mockito.any());
  }

  @Test
  @DisplayName("AGENT 담당 이슈 상태 변경 → status_changed 1회, previous/new 정확")
  void status_change_on_agent_issue_publishes_status_changed() {
    var fx = seed();
    var issue =
        issueService.create(
            fx.humanId(),
            fx.projectKey(),
            new CreateIssueRequest("AI 작업", "본문", "MID", null, List.of(fx.agentId()), null, null));
    // setup 단계 비동기 발사 2회 완료 대기 후 reset.
    verify(client, timeout(2000).times(2)).publish(any(EventEnvelope.class));
    org.mockito.Mockito.reset(client);
    doNothing().when(client).publish(any(EventEnvelope.class));

    issueService.updateStatus(fx.humanId(), fx.projectKey(), issue.number(), "IN_PROGRESS");

    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, timeout(2000).times(1)).publish(captor.capture());
    var env = captor.getValue();
    assertThat(env.type()).isEqualTo("issue.status_changed");
    assertThat(env.payload()).containsEntry("previousStatus", "TODO");
    assertThat(env.payload()).containsEntry("newStatus", "IN_PROGRESS");
  }
}
