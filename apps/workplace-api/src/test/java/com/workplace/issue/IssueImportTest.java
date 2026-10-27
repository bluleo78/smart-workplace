package com.workplace.issue;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ISSUE_FIELD_VALUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssuePriorityChangedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.repository.ProjectStatusRepository;
import com.workplace.issue.service.IssueFieldDefService;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.issue.service.IssueService;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 가져오기 API(WP-883 원작성자·원시각 보존, WP-884 알림 억제) 통합 테스트 — 관리자만(프로젝트 OWNER·AI 구성원 거절), 원래 보고자·시각·
 * 담당자·워처·필드가 그대로 남는지, 알림·푸시·AI 착수를 만드는 이벤트가 하나도 나가지 않는지(화면 갱신 1건만), 번호·원본 키 중복은 409, 맞지 않는 사용자·시각은
 * 400 인지를 본다.
 *
 * <p>테스트 트랜잭션 안이라 AFTER_COMMIT 비동기 리스너는 돌지 않는다 — 그래서 알림을 만드는 원인 이벤트가 발행되지 않았음을 {@link
 * RecordApplicationEvents} 로 단언한다(대조군: 같은 조건의 일반 생성은 그 이벤트와 AI 작업 행을 만든다).
 */
@Transactional
@RecordApplicationEvents
class IssueImportTest extends IssueImportTestSupport {

  @Autowired ApplicationEvents events;
  @Autowired ProjectStatusRepository statusRepository;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired CycleService cycleService;
  @Autowired IssueFieldDefService fieldDefService;
  @Autowired IssueService issueService;
  @Autowired IssueSearchService searchService;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired UserApiTokenRepository userTokens;
  @Autowired JwtTokenProvider jwt;

  private long assignee;
  private long watcher;
  private long completedCycleId;
  private long fieldDefId;
  private long doneStatusId;

  @BeforeEach
  void seed() {
    seedProject("IM", "가져오기");
    assignee = member();
    watcher = member();
    completedCycleId =
        cycleService
            .create(owner, key, new CreateCycleRequest("지난 스프린트", null, null, null, "COMPLETED"))
            .id();
    fieldDefId =
        fieldDefService
            .create(owner, key, new CreateIssueFieldDefRequest("점수", "NUMBER", null))
            .id();
    doneStatusId = statusRepository.findDefault(projectId, "DONE").orElseThrow().id();
  }

  /** 이 클래스의 기준 생성 시각(응답의 createdAt 단언이 이 값을 본다). */
  @Override
  String defaultCreatedAt() {
    return "2026-06-11T09:00:00+09:00";
  }

  private int issueCount() {
    return dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId));
  }

  /** 원래 보고자·생성·수정·종료 시각·담당자·워처(목록 그대로)·완료 사이클·커스텀 필드가 요청 값 그대로 남는 가져오기 본문. */
  private Map<String, Object> fullBody() {
    Map<String, Object> m = body("원본 이슈");
    m.put("statusId", doneStatusId);
    m.put("updatedAt", "2026-06-21T18:00:00+09:00");
    m.put("closedAt", "2026-06-21T10:00:00+09:00");
    m.put("assignees", List.of(username(assignee)));
    m.put("watchers", List.of(username(reporter)));
    m.put("cycleIds", List.of(completedCycleId));
    m.put("fields", List.of(Map.of("defId", fieldDefId, "value", 7)));
    return m;
  }

  @Test
  void admin_importsWithOriginalPeopleAndTimes() throws Exception {
    var r = importAs(admin, fullBody()).andExpect(status().isCreated());
    int number = numberOf(r);
    r.andExpect(jsonPath("$.reporterId").value(reporter))
        .andExpect(jsonPath("$.createdAt").value("2026-06-11T00:00:00Z"));

    var detail = issueService.get(admin, key, number);
    assertThat(detail.reporter().id()).isEqualTo(reporter);
    assertThat(detail.summary().createdAt())
        .isEqualTo(OffsetDateTime.parse("2026-06-11T09:00:00+09:00").toInstant());
    assertThat(detail.summary().updatedAt())
        .isEqualTo(OffsetDateTime.parse("2026-06-21T18:00:00+09:00").toInstant());
    assertThat(detail.summary().closedAt())
        .isEqualTo(OffsetDateTime.parse("2026-06-21T10:00:00+09:00").toInstant());
    assertThat(detail.summary().status()).isEqualTo("DONE");
    assertThat(detail.summary().assignees()).extracting(a -> a.id()).containsExactly(assignee);

    long id = issueId(number);
    // 담당자 지정자는 호출자(관리자).
    assertThat(
            dsl.select(ISSUE_ASSIGNEE.ASSIGNED_BY)
                .from(ISSUE_ASSIGNEE)
                .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(id))
                .fetchOne(ISSUE_ASSIGNEE.ASSIGNED_BY))
        .isEqualTo(admin);
    // 워처는 넘긴 목록 그대로 — 담당자·호출자 자동 등록 없음.
    assertThat(
            dsl.select(ISSUE_WATCHER.USER_ID)
                .from(ISSUE_WATCHER)
                .where(ISSUE_WATCHER.ISSUE_ID.eq(id))
                .fetch(ISSUE_WATCHER.USER_ID))
        .containsExactly(reporter);
    assertThat(
            dsl.select(ISSUE_CYCLE.CYCLE_ID)
                .from(ISSUE_CYCLE)
                .where(ISSUE_CYCLE.ISSUE_ID.eq(id))
                .fetch(ISSUE_CYCLE.CYCLE_ID))
        .containsExactly(completedCycleId);
    assertThat(
            dsl.select(ISSUE_FIELD_VALUE.VALUE)
                .from(ISSUE_FIELD_VALUE)
                .where(ISSUE_FIELD_VALUE.ISSUE_ID.eq(id))
                .fetchOne(ISSUE_FIELD_VALUE.VALUE)
                .data())
        .isEqualTo("7");
    // 가져오기 자체가 만드는 자동 이력(담당자 지정·필드 변경 등)은 없다.
    assertThat(dsl.fetchCount(ISSUE_HISTORY, ISSUE_HISTORY.ISSUE_ID.eq(id))).isZero();
  }

  @Test
  void importEmitsNoNotificationOrAiEvents() throws Exception {
    // AI 담당자도 넣는다 — 외부 실행 AI 는 일반 생성이면 시작 전 작업(agent_work)이 생긴다.
    long agent = externalAgentMember();
    Map<String, Object> m = fullBody();
    m.remove("statusId");
    m.remove("closedAt");
    m.put("assignees", List.of(username(assignee), username(agent)));
    events.clear();

    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));
    long id = issueId(number);

    for (Class<?> c :
        List.of(
            IssueCreatedEvent.class,
            IssueAssignedEvent.class,
            IssueCommentedEvent.class,
            IssueStatusChangedEvent.class,
            IssuePriorityChangedEvent.class,
            WatcherAddedEvent.class,
            AgentToolWriteEvent.class,
            IssueHumanReplyPosted.class,
            InboxPushRequestedEvent.class)) {
      assertThat(events.stream(c).count()).as(c.getSimpleName()).isZero();
    }
    assertThat(events.stream(ResourceChangedEvent.class).count()).isEqualTo(1);
    assertThat(dsl.fetchCount(NOTIFICATION)).isZero();
    assertThat(dsl.fetchCount(AGENT_WORK, AGENT_WORK.ISSUE_ID.eq(id))).isZero();

    // 대조군 — 같은 AI 를 담당으로 둔 일반 생성은 담당 이벤트와 AI 작업 행을 만든다(위 0건이 측정 가능한 값임을 보인다).
    events.clear();
    var normal =
        issueService.create(
            owner,
            key,
            new CreateIssueRequest("일반", null, null, null, List.of(agent), null, null, null));
    assertThat(events.stream(IssueAssignedEvent.class).count()).isEqualTo(1);
    assertThat(dsl.fetchCount(AGENT_WORK, AGENT_WORK.ISSUE_ID.eq(normal.id()))).isEqualTo(1);
  }

  /** 외부 실행(EXTERNAL) AI 구성원 — 테넌트 활성 구성원이자 프로젝트 멤버. */
  private long externalAgentMember() {
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
    TestFixtures.activeMemberOfCurrentTenant(dsl, agent);
    dsl.update(USER)
        .set(USER.AGENT_RUNTIME, AgentRuntime.EXTERNAL)
        .where(USER.ID.eq(agent))
        .execute();
    memberRepository.insert(projectId, agent, "MEMBER");
    return agent;
  }

  @Test
  void nonAdmin_403_evenProjectOwner() throws Exception {
    importAs(owner, body("소유자"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_ADMIN_ONLY"));
    assertThat(issueCount()).isZero();
  }

  @Test
  void personalProject_400() throws Exception {
    var personal =
        projectService.create(admin, new CreateProjectRequest(null, "내 일", null, "PERSONAL"));
    Map<String, Object> m = body("개인");
    m.put("reporter", username(admin));
    importAs(admin, personal.key(), m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_PERSONAL_PROJECT"));
  }

  @Test
  void agentCaller_403() throws Exception {
    long agent = externalAgentMember();
    TestFixtures.grantRole(dsl, agent, "ADMIN");
    importAs(agent, body("AI 호출"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_ADMIN_ONLY"));
    assertThat(issueCount()).isZero();
  }

  @Test
  void openChildUnderDoneEpic_andCompletedCycle_allowed() throws Exception {
    long epicTypeId = typeRepository.findByProjectAndName(projectId, "EPIC").orElseThrow().id();
    Map<String, Object> epic = body("완료 에픽");
    epic.put("typeId", epicTypeId);
    epic.put("statusId", doneStatusId);
    int epicNumber = numberOf(importAs(admin, epic).andExpect(status().isCreated()));

    Map<String, Object> child = body("미완료 하위");
    child.put("parentNumber", epicNumber);
    child.put("cycleIds", List.of(completedCycleId));
    int childNumber = numberOf(importAs(admin, child).andExpect(status().isCreated()));

    var row = dsl.selectFrom(ISSUE).where(ISSUE.ID.eq(issueId(childNumber))).fetchOne();
    assertThat(row.getParentIssueId()).isEqualTo(issueId(epicNumber));
    assertThat(row.getStatus()).isEqualTo("TODO");
    assertThat(row.getImportedBy()).isEqualTo(admin);
    assertThat(row.getImportedAt()).isNotNull();
  }

  /** 소유자가 가진 다른 팀 프로젝트 하나(WP-1038 다른 프로젝트 에픽 부모용). 관리자는 멤버가 아니어도 ADMIN 우회로 읽을 수 있다. */
  private ProjectResponse otherTeamProject() {
    String otherKey =
        "IO" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    return projectService.create(owner, new CreateProjectRequest(otherKey, "다른 프로젝트", "x"));
  }

  /** 그 프로젝트에 유형 이름의 이슈를 하나 만든다. */
  private IssueResponse createIn(ProjectResponse p, String typeName, String title) {
    long typeId = typeRepository.findByProjectAndName(p.id(), typeName).orElseThrow().id();
    return issueService.create(
        owner, p.key(), new CreateIssueRequest(title, null, null, null, null, typeId, null, null));
  }

  @Test
  void parentKey_otherProjectEpic_setsParent() throws Exception {
    ProjectResponse other = otherTeamProject();
    IssueResponse epic = createIn(other, "EPIC", "다른 프로젝트 에픽");

    Map<String, Object> child = body("다른 에픽의 하위");
    child.put("parentKey", other.key() + "-" + epic.number());
    int childNumber = numberOf(importAs(admin, child).andExpect(status().isCreated()));

    assertThat(
            dsl.select(ISSUE.PARENT_ISSUE_ID)
                .from(ISSUE)
                .where(ISSUE.ID.eq(issueId(childNumber)))
                .fetchOne(ISSUE.PARENT_ISSUE_ID))
        .isEqualTo(epic.id());
  }

  @Test
  void parentKey_otherProjectNonEpic_400_nothingWritten() throws Exception {
    ProjectResponse other = otherTeamProject();
    IssueResponse task = createIn(other, "TASK", "다른 프로젝트 작업");

    Map<String, Object> child = body("에픽 아닌 부모");
    child.put("parentKey", other.key() + "-" + task.number());
    importAs(admin, child).andExpect(status().isBadRequest());
    assertThat(issueCount()).isZero();
  }

  @Test
  void parentKey_unknownOrMalformed_400() throws Exception {
    Map<String, Object> missing = body("없는 부모");
    missing.put(
        "parentKey", "NOPE" + UUID.randomUUID().toString().substring(0, 4).toUpperCase() + "-1");
    importAs(admin, missing)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("부모로 지정한 이슈를 찾을 수 없습니다"));

    Map<String, Object> malformed = body("틀린 키");
    malformed.put("parentKey", "not a key");
    importAs(admin, malformed).andExpect(status().isBadRequest());
    assertThat(issueCount()).isZero();
  }

  @Test
  void specifiedNumber_usedAndSequenceRaised() throws Exception {
    Map<String, Object> m = body("17번");
    m.put("number", 17);
    importAs(admin, m).andExpect(status().isCreated()).andExpect(jsonPath("$.number").value(17));

    IssueResponse next =
        issueService.create(
            owner, key, new CreateIssueRequest("다음", null, null, null, null, null, null, null));
    assertThat(next.number()).isEqualTo(18);
  }

  @Test
  void sameNumber_409() throws Exception {
    Map<String, Object> m = body("5번");
    m.put("number", 5);
    importAs(admin, m).andExpect(status().isCreated());
    importAs(admin, m)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_NUMBER_TAKEN"));
    assertThat(issueCount()).isEqualTo(1);
  }

  @Test
  void numberOfSoftDeletedIssue_409() throws Exception {
    Map<String, Object> m = body("지울 이슈");
    m.put("number", 3);
    importAs(admin, m).andExpect(status().isCreated());
    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(issueId(3)))
        .execute();

    importAs(admin, m)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_NUMBER_TAKEN"));
  }

  @Test
  void sameSourceKey_secondImport409() throws Exception {
    Map<String, Object> m = body("원본 CLIM-17");
    m.put("sourceKey", "CLIM-17");
    importAs(admin, m).andExpect(status().isCreated());
    importAs(admin, m)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_SOURCE_KEY_TAKEN"));
    assertThat(issueCount()).isEqualTo(1);
    assertThat(
            dsl.select(ISSUE.IMPORT_SOURCE_KEY)
                .from(ISSUE)
                .where(ISSUE.PROJECT_ID.eq(projectId))
                .fetchOne(ISSUE.IMPORT_SOURCE_KEY))
        .isEqualTo("CLIM-17");
  }

  @Test
  void unknownUsers_400_listsAll() throws Exception {
    long outsider = human(); // 테넌트 구성원이지만 프로젝트 멤버는 아님
    Map<String, Object> m = body("모르는 사람");
    m.put("reporter", username(outsider));
    m.put("watchers", List.of("no-such-user-zz"));
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_UNKNOWN_USERS"))
        .andExpect(
            jsonPath("$.errors.usernames")
                .value(
                    String.join(
                        ",",
                        List.of(username(outsider), "no-such-user-zz").stream()
                            .sorted()
                            .toList())));
    assertThat(issueCount()).isZero();
  }

  @Test
  void updatedBeforeCreated_400() throws Exception {
    Map<String, Object> m = body("시각 역전");
    m.put("updatedAt", "2026-06-10T09:00:00+09:00");
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_INVALID_TIMES"));
    assertThat(issueCount()).isZero();
  }

  /** 종료 시각은 수정 시각보다 늦을 수 없다 — 종료도 변경이라 수정 시각은 종료 이후여야 한다. */
  @Test
  void closedAfterUpdated_400() throws Exception {
    Map<String, Object> m = fullBody();
    m.put("updatedAt", "2026-06-20T18:00:00+09:00");
    m.put("closedAt", "2026-06-21T10:00:00+09:00");
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_INVALID_TIMES"));
    assertThat(issueCount()).isZero();
  }

  /** 댓글 작성 시각이 이슈 생성 시각보다 이르면 400. */
  @Test
  void commentBeforeIssueCreated_400() throws Exception {
    Map<String, Object> m = body("댓글 시각");
    m.put(
        "comments",
        List.of(
            Map.of(
                "author",
                username(reporter),
                "createdAt",
                "2026-06-10T09:00:00+09:00",
                "body",
                "너무 이른 댓글")));
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_INVALID_TIMES"));
    assertThat(issueCount()).isZero();
  }

  /** 첨부 시각이 이슈 생성 시각보다 이르면 400(파일 조회 전에 걸러진다). */
  @Test
  void attachmentBeforeIssueCreated_400() throws Exception {
    Map<String, Object> m = body("첨부 시각");
    m.put(
        "attachments",
        List.of(
            Map.of(
                "fileId",
                1L,
                "attachedBy",
                username(reporter),
                "attachedAt",
                "2026-06-10T09:00:00+09:00")));
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_INVALID_TIMES"));
    assertThat(issueCount()).isZero();
  }

  /** 이력 시각이 이슈 생성 시각보다 이르면 400. */
  @Test
  void historyBeforeIssueCreated_400() throws Exception {
    Map<String, Object> m = body("이력 시각");
    m.put(
        "history",
        List.of(
            Map.of(
                "type",
                "TITLE_CHANGED",
                "actor",
                username(reporter),
                "at",
                "2026-06-10T09:00:00+09:00",
                "to",
                "새 제목")));
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_INVALID_TIMES"));
    assertThat(issueCount()).isZero();
  }

  @Test
  void closedAtOnOpenStatus_400() throws Exception {
    Map<String, Object> m = body("열린 이슈에 종료 시각");
    m.put("closedAt", "2026-06-21T10:00:00+09:00");
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_INVALID_TIMES"));
    assertThat(issueCount()).isZero();
  }

  /**
   * 생성 시각은 요청 값이 그대로 정렬·필터 기준이 된다. 목록 기본 정렬은 수정 시각 내림차순이라 updatedAt 을 비워(= createdAt) 원래 생성 순서의 역순이
   * 나오는지 보고, createdFrom 은 Asia/Seoul 날짜 경계로 자른다. 오프셋을 섞어(+09:00·Z) 문자열 순서와 시각 순서가 다르게 둔다.
   */
  @Test
  void createdAt_orderAndFilterUseOriginalTimes() throws Exception {
    // a: KST 06-12 00:30 (= UTC 06-11 15:30) — 문자열로는 06-11 이지만 KST 로는 06-12.
    // b: KST 06-11 23:00 — KST 06-11.
    // c: KST 06-12 08:00 (= UTC 06-11 23:00).
    Map<String, Object> a = body("a");
    a.put("createdAt", "2026-06-11T15:30:00Z");
    Map<String, Object> b = body("b");
    b.put("createdAt", "2026-06-11T23:00:00+09:00");
    Map<String, Object> c = body("c");
    c.put("createdAt", "2026-06-11T23:00:00Z");
    int nc = numberOf(importAs(admin, c).andExpect(status().isCreated()));
    int na = numberOf(importAs(admin, a).andExpect(status().isCreated()));
    int nb = numberOf(importAs(admin, b).andExpect(status().isCreated()));
    // 요청 순서(c, a, b)와 무관하게 시각 순서 b < a < c.

    // 저장된 생성 시각이 세 건 모두 원래 시각 그대로.
    assertThat(storedCreatedAt(na)).isEqualTo(Instant.parse("2026-06-11T15:30:00Z"));
    assertThat(storedCreatedAt(nb)).isEqualTo(Instant.parse("2026-06-11T14:00:00Z"));
    assertThat(storedCreatedAt(nc)).isEqualTo(Instant.parse("2026-06-11T23:00:00Z"));

    var all = searchService.search(admin, key, Map.of());
    assertThat(all.items()).extracting(IssueResponse::title).containsExactly("c", "a", "b");

    var fromJune12 = searchService.search(admin, key, Map.of("createdFrom", "2026-06-12"));
    assertThat(fromJune12.items()).extracting(IssueResponse::title).containsExactly("c", "a");
  }

  private Instant storedCreatedAt(int number) {
    return dsl.select(ISSUE.CREATED_AT)
        .from(ISSUE)
        .where(ISSUE.ID.eq(issueId(number)))
        .fetchOne(ISSUE.CREATED_AT)
        .toInstant();
  }

  /** 번호 상한 — number+1 로 시퀀스를 올리므로 int 최댓값이 넘치지 않게 10억까지만 받는다. */
  @Test
  void numberOverLimit_400() throws Exception {
    Map<String, Object> m = body("너무 큰 번호");
    m.put("number", Integer.MAX_VALUE);
    importAs(admin, m).andExpect(status().isBadRequest());
    assertThat(issueCount()).isZero();

    m.put("number", 1_000_000_000);
    importAs(admin, m)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.number").value(1_000_000_000));
  }

  /** 실제 인증 필터(Authorization 헤더)로 부른다 — 필터가 finally 에서 지운 테스트 스레드 TenantContext 를 되돌린다. */
  private ResultActions importWithHeader(String authorization, Map<String, Object> body)
      throws Exception {
    try {
      return mvc.perform(
          post("/api/v1/projects/" + key + "/import/issues")
              .header("Authorization", authorization)
              .contentType(MediaType.APPLICATION_JSON)
              .content(objectMapper.writeValueAsString(body)));
    } finally {
      TenantContext.set(1L);
    }
  }

  /** 개인 토큰(swp_) 을 저장소에 해시로 직접 넣는다 — 필터는 해시만 대조한다(AiMemoryAuthBoundaryTest 와 같은 방식). */
  private String personalToken(long uid) throws Exception {
    String pat = "swp_wp883import" + UUID.randomUUID().toString().replace("-", "");
    String hash =
        HexFormat.of()
            .formatHex(
                MessageDigest.getInstance("SHA-256").digest(pat.getBytes(StandardCharsets.UTF_8)));
    userTokens.insert(uid, 1L, "wp883", pat.substring(0, 12), hash, null);
    return pat;
  }

  /** 일반 구성원 — 시스템 USER 역할(issue:write 있음)만 있고 ADMIN 은 없다. */
  private long plainMember() {
    long uid = human();
    TestFixtures.grantRole(dsl, uid, "USER");
    memberRepository.insert(projectId, uid, "MEMBER");
    return uid;
  }

  /** 관리자는 개인 토큰으로 가져올 수 있다 — ADMIN 역할의 실제 권한 매핑(issue:write)을 거친다. */
  @Test
  void admin_personalToken_201() throws Exception {
    importWithHeader("Bearer " + personalToken(admin), body("개인 토큰"))
        .andExpect(status().isCreated());
    assertThat(issueCount()).isEqualTo(1);
  }

  /** 관리자는 로그인(JWT) 토큰으로도 가져올 수 있다. */
  @Test
  void admin_jwt_201() throws Exception {
    String token = jwt.generateAccessToken(admin, username(admin), 1L);
    importWithHeader("Bearer " + token, body("JWT")).andExpect(status().isCreated());
    assertThat(issueCount()).isEqualTo(1);
  }

  /** issue:write 는 있지만 ADMIN 이 아닌 구성원의 개인 토큰 — 인터셉터는 통과하고 서비스가 IMPORT_ADMIN_ONLY 로 거절한다. */
  @Test
  void member_personalToken_403_adminOnly() throws Exception {
    long member = plainMember();
    importWithHeader("Bearer " + personalToken(member), body("구성원 토큰"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_ADMIN_ONLY"));
    assertThat(issueCount()).isZero();
  }

  /** 같은 구성원의 JWT 도 마찬가지. */
  @Test
  void member_jwt_403_adminOnly() throws Exception {
    long member = plainMember();
    String token = jwt.generateAccessToken(member, username(member), 1L);
    importWithHeader("Bearer " + token, body("구성원 JWT"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_ADMIN_ONLY"));
    assertThat(issueCount()).isZero();
  }

  @Test
  void auditLogWritten() throws Exception {
    Map<String, Object> m = body("감사");
    m.put("sourceKey", "CLIM-9");
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    var rows =
        dsl.selectFrom(AUDIT_LOG)
            .where(AUDIT_LOG.ACTION_TYPE.eq("ISSUE_IMPORTED"))
            .and(AUDIT_LOG.RESOURCE_ID.eq(key + "-" + number))
            .fetch();
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getUserId()).isEqualTo(admin);
    assertThat(rows.get(0).getResource()).isEqualTo("issue");
    JsonNode meta = objectMapper.readTree(rows.get(0).getMetadata().data());
    assertThat(meta.get("sourceKey").asText()).isEqualTo("CLIM-9");
    assertThat(meta.get("reporter").asText()).isEqualTo(username(reporter));
    assertThat(meta.get("comments").asInt()).isZero();
  }
}
