package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.SAVED_VIEW;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.audit.dto.AuditLogResponse;
import com.workplace.audit.repository.AuditLogRepository;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.issue.dto.StatusDeletionImpact;
import com.workplace.issue.exception.EpicHasIncompleteChildrenException;
import com.workplace.issue.exception.InvalidStatusForProjectException;
import com.workplace.issue.exception.StatusEditNotSupportedException;
import com.workplace.issue.exception.StatusLastInCategoryException;
import com.workplace.issue.exception.StatusMoveTargetRequiredException;
import com.workplace.issue.exception.StatusNotFoundException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.PersonalProjectProvisioner;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.view.dto.SaveViewRequest;
import com.workplace.view.repository.SavedViewRepository;
import jakarta.validation.Validator;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 상태 삭제와 이슈 이전(WP-809) 통합 테스트. 픽스처 TEAM 프로젝트는 기본 4상태에 「검토 중」(진행 중 범주)·「배포됨」(완료 범주)을 더해 둔다. 이전은 조용해야
 * 하고(updatedAt·version·알림 그대로), 종료 시각·AI 작업·에픽 규칙·이력·저장된 뷰·감사 로그를 함께 맞추는지 본다.
 */
@Transactional
@RecordApplicationEvents
class ProjectStatusDeletionTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectStatusDeletionService deletionService;
  @Autowired ProjectStatusService statusService;
  @Autowired IssueService issueService;
  @Autowired IssueSearchService issueSearchService;
  @Autowired ProjectService projectService;
  @Autowired PersonalProjectProvisioner personalProjectProvisioner;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired SavedViewRepository savedViewRepository;
  @Autowired AuditLogRepository auditLogRepository;
  @Autowired ObjectMapper objectMapper;
  @Autowired ApplicationEvents events;
  @Autowired Validator validator;

  private Long owner;
  private ProjectResponse project;
  private long todo;
  private long inProgress;
  private long done;
  private long review;
  private long deployed;

  private Long createUser(String prefix) {
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
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(
        ownerId, new CreateProjectRequest(prefix + suffix, "P-" + prefix, "x", "TEAM"));
  }

  private long statusId(String name) {
    return statusService.list(owner, project.key()).stream()
        .filter(s -> s.name().equals(name))
        .findFirst()
        .map(ProjectStatusResponse::id)
        .orElseThrow();
  }

  private long addStatus(String name, String category) {
    return statusService
        .create(owner, project.key(), new CreateProjectStatusRequest(name, category, null, null))
        .id();
  }

  @BeforeEach
  void seed() {
    owner = createUser("sd");
    project = newProject(owner, "SD");
    todo = statusId("할 일");
    inProgress = statusId("진행 중");
    done = statusId("완료");
    review = addStatus("검토 중", "IN_PROGRESS");
    deployed = addStatus("배포됨", "DONE");
  }

  private IssueResponse create(Long statusId) {
    return createIn(statusId, null, null);
  }

  private IssueResponse createIn(Long statusId, Long typeId, Integer parentNumber) {
    return issueService.create(
        owner,
        project.key(),
        new CreateIssueRequest(
            "t",
            null,
            null,
            null,
            List.of(),
            typeId,
            parentNumber,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            statusId));
  }

  private long typeId(String name) {
    return typeRepository.findByProjectAndName(project.id(), name).orElseThrow().id();
  }

  /** 에픽을 만들고 그 아래 하위를 만든다 — 하위를 먼저 지정 상태로 두고 에픽 상태를 맞춘다(에픽 완료 차단을 피하려고). */
  private IssueResponse epic(long statusId) {
    return createIn(statusId, typeId("EPIC"), null);
  }

  private IssueResponse child(IssueResponse parent, long statusId) {
    return createIn(statusId, null, parent.number());
  }

  /** 이슈 행을 DB 에서 바로 읽는다(서비스 응답은 상태 이름을 다시 조인하므로 이전 결과 확인엔 행이 정확하다). */
  private org.jooq.Record issueRow(long id) {
    return dsl.select(
            ISSUE.STATUS,
            ISSUE.STATUS_ID,
            ISSUE.CLOSED_AT,
            ISSUE.UPDATED_AT,
            ISSUE.VERSION,
            ISSUE.DELETED_AT)
        .from(ISSUE)
        .where(ISSUE.ID.eq(id))
        .fetchOne();
  }

  private boolean statusExists(long id) {
    return dsl.fetchExists(PROJECT_STATUS, PROJECT_STATUS.ID.eq(id));
  }

  private List<String> history(long issueId, String eventType) {
    return dsl.select(ISSUE_HISTORY.FROM_VALUE, ISSUE_HISTORY.TO_VALUE)
        .from(ISSUE_HISTORY)
        .where(ISSUE_HISTORY.ISSUE_ID.eq(issueId))
        .and(ISSUE_HISTORY.EVENT_TYPE.eq(eventType))
        .orderBy(ISSUE_HISTORY.ID.asc())
        .fetch(r -> r.value1() + "→" + r.value2());
  }

  private void seedWorking(long issueId) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, owner)
        .set(AGENT_WORK.TOOL, "claude-code")
        .set(AGENT_WORK.STATE, "WORKING")
        .set(AGENT_WORK.UPDATED_AT, OffsetDateTime.now())
        .execute();
  }

  private String viewQuery(long viewId) {
    return dsl.select(SAVED_VIEW.QUERY)
        .from(SAVED_VIEW)
        .where(SAVED_VIEW.ID.eq(viewId))
        .fetchOne(SAVED_VIEW.QUERY);
  }

  private long addView(Long ownerId, String name, String query, String visibility) {
    return savedViewRepository.insert(project.id(), ownerId, name, query, visibility).id();
  }

  private void delete(long statusId, Long moveTo) {
    deletionService.delete(owner, project.key(), statusId, moveTo);
  }

  private List<AuditLogResponse> deleteLogs() {
    return auditLogRepository.findByResource("DELETE", "project_status", null).stream()
        .filter(l -> project.key().equals(meta(l).path("projectKey").asText()))
        .toList();
  }

  private JsonNode meta(AuditLogResponse log) {
    try {
      return log.metadata() == null
          ? objectMapper.createObjectNode()
          : objectMapper.readTree(log.metadata());
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @Test
  void 범주의_마지막상태는_409() {
    assertThatThrownBy(() -> delete(todo, null))
        .isInstanceOf(StatusLastInCategoryException.class)
        .hasMessage("범주의 마지막 상태는 지울 수 없어요");
    assertThat(statusExists(todo)).isTrue();
  }

  @Test
  void 이슈가_있는데_moveTo가_없으면_400() {
    create(review);

    assertThatThrownBy(() -> delete(review, null))
        .isInstanceOf(StatusMoveTargetRequiredException.class)
        .hasMessage("옮길 상태를 골라 주세요");
    assertThat(statusExists(review)).isTrue();
  }

  @Test
  void moveTo가_자기자신_다른프로젝트면_400_없으면_404() {
    create(review);
    var other = newProject(owner, "SX");
    long foreign =
        statusService.list(owner, other.key()).stream()
            .filter(s -> s.name().equals("진행 중"))
            .findFirst()
            .orElseThrow()
            .id();

    assertThatThrownBy(() -> delete(review, review))
        .isInstanceOf(InvalidStatusForProjectException.class);
    assertThatThrownBy(() -> delete(review, foreign))
        .isInstanceOf(InvalidStatusForProjectException.class);
    assertThatThrownBy(() -> delete(review, Long.MAX_VALUE))
        .isInstanceOf(StatusNotFoundException.class);
    assertThat(statusExists(review)).isTrue();
  }

  @Test
  void 같은범주_이전은_status_closedAt을_그대로_둔다() {
    var issue = create(review);

    delete(review, inProgress);

    var row = issueRow(issue.id());
    assertThat(row.get(ISSUE.STATUS_ID)).isEqualTo(inProgress);
    assertThat(row.get(ISSUE.STATUS)).isEqualTo("IN_PROGRESS");
    assertThat(row.get(ISSUE.CLOSED_AT)).isNull();
    assertThat(statusExists(review)).isFalse();
  }

  @Test
  void 다른범주_DONE으로_이전하면_closedAt이_찍힌다() {
    var issue = create(review);

    delete(review, done);

    var row = issueRow(issue.id());
    assertThat(row.get(ISSUE.STATUS_ID)).isEqualTo(done);
    assertThat(row.get(ISSUE.STATUS)).isEqualTo("DONE");
    assertThat(row.get(ISSUE.CLOSED_AT)).isNotNull();
  }

  @Test
  void DONE에서_열린범주로_이전하면_closedAt이_지워진다() {
    var issue = create(deployed);
    assertThat(issueRow(issue.id()).get(ISSUE.CLOSED_AT)).isNotNull();

    delete(deployed, todo);

    var row = issueRow(issue.id());
    assertThat(row.get(ISSUE.STATUS)).isEqualTo("TODO");
    assertThat(row.get(ISSUE.CLOSED_AT)).isNull();
  }

  @Test
  void 종료범주끼리_이전은_closedAt을_유지한다() {
    var issue = create(deployed);
    var closedAt = issueRow(issue.id()).get(ISSUE.CLOSED_AT);

    delete(deployed, done);

    assertThat(issueRow(issue.id()).get(ISSUE.CLOSED_AT)).isEqualTo(closedAt);
  }

  @Test
  void 이전은_updatedAt과_version을_올리지_않는다() {
    var issue = create(review);
    var before = issueRow(issue.id());

    delete(review, done);

    var after = issueRow(issue.id());
    assertThat(after.get(ISSUE.UPDATED_AT)).isEqualTo(before.get(ISSUE.UPDATED_AT));
    assertThat(after.get(ISSUE.VERSION)).isEqualTo(before.get(ISSUE.VERSION));
  }

  @Test
  void 옮긴_이슈마다_STATUS_MIGRATED_이력() {
    var a = create(review);
    var b = create(review);
    var untouched = create(todo);

    delete(review, inProgress);

    assertThat(history(a.id(), "STATUS_MIGRATED")).containsExactly("검토 중→진행 중");
    assertThat(history(b.id(), "STATUS_MIGRATED")).containsExactly("검토 중→진행 중");
    assertThat(history(untouched.id(), "STATUS_MIGRATED")).isEmpty();
    assertThat(history(a.id(), "STATUS_CHANGED")).isEmpty();
    // 행위자는 지운 사람
    assertThat(
            dsl.select(ISSUE_HISTORY.ACTOR_ID)
                .from(ISSUE_HISTORY)
                .where(ISSUE_HISTORY.ISSUE_ID.eq(a.id()))
                .and(ISSUE_HISTORY.EVENT_TYPE.eq("STATUS_MIGRATED"))
                .fetchOne(ISSUE_HISTORY.ACTOR_ID))
        .isEqualTo(owner);
  }

  @Test
  void 이전은_상태변경_이벤트와_알림을_내지_않는다() {
    create(review);
    create(deployed);
    events.clear();

    delete(review, done);
    delete(deployed, inProgress);

    assertThat(events.stream(IssueStatusChangedEvent.class)).isEmpty();
  }

  @Test
  void DONE으로_이전하면_AI작업이_종료된다() {
    var issue = create(review);
    seedWorking(issue.id());

    delete(review, done);

    assertThat(
            dsl.select(AGENT_WORK.STATE)
                .from(AGENT_WORK)
                .where(AGENT_WORK.ISSUE_ID.eq(issue.id()))
                .fetch(AGENT_WORK.STATE))
        .containsExactly("COMPLETED");
  }

  @Test
  void CANCELED로_이전하면_AI작업이_취소된다() {
    long onHold = addStatus("보류", "CANCELED");
    var issue = create(review);
    seedWorking(issue.id());

    delete(review, onHold);

    assertThat(
            dsl.select(AGENT_WORK.STATE)
                .from(AGENT_WORK)
                .where(AGENT_WORK.ISSUE_ID.eq(issue.id()))
                .fetch(AGENT_WORK.STATE))
        .containsExactly("CANCELED");
  }

  @Test
  void 종료범주끼리_이전은_AI작업을_건드리지_않는다() {
    var issue = create(deployed);
    seedWorking(issue.id());

    delete(deployed, done);

    assertThat(
            dsl.fetchCount(
                AGENT_WORK, AGENT_WORK.ISSUE_ID.eq(issue.id()).and(AGENT_WORK.ENDED_AT.isNull())))
        .isEqualTo(1);
  }

  @Test
  void 휴지통_이슈만_남은_상태도_moveTo_없이_삭제된다() {
    var trashed = create(review);
    issueService.softDelete(owner, project.key(), trashed.number());

    delete(review, null);

    assertThat(statusExists(review)).isFalse();
    var row = issueRow(trashed.id());
    assertThat(row.get(ISSUE.STATUS_ID)).isEqualTo(inProgress);
    assertThat(row.get(ISSUE.DELETED_AT)).isNotNull();
    assertThat(history(trashed.id(), "STATUS_MIGRATED")).containsExactly("검토 중→진행 중");
  }

  @Test
  void 기본상태를_지우면_휴지통_이슈는_같은범주_다음상태로_간다() {
    var trashed = create(inProgress);
    issueService.softDelete(owner, project.key(), trashed.number());

    delete(inProgress, null);

    assertThat(issueRow(trashed.id()).get(ISSUE.STATUS_ID)).isEqualTo(review);
  }

  @Test
  void 미완료하위가_있는_에픽은_DONE이전을_막는다() {
    var e = epic(review);
    var c = child(e, todo);

    assertThatThrownBy(() -> delete(review, deployed))
        .isInstanceOf(EpicHasIncompleteChildrenException.class)
        .hasMessage("미완료 하위가 있는 에픽 1개 때문에 완료 범주로 옮길 수 없어요");
    assertThat(statusExists(review)).isTrue();
    assertThat(issueRow(e.id()).get(ISSUE.STATUS_ID)).isEqualTo(review);
    assertThat(issueRow(c.id()).get(ISSUE.STATUS_ID)).isEqualTo(todo);
  }

  @Test
  void 같은상태의_하위는_함께_옮겨지므로_에픽차단에서_빠진다() {
    var e = epic(review);
    var c = child(e, review);

    delete(review, done);

    assertThat(issueRow(e.id()).get(ISSUE.STATUS)).isEqualTo("DONE");
    assertThat(issueRow(c.id()).get(ISSUE.STATUS)).isEqualTo("DONE");
  }

  @Test
  void 완료범주_삭제를_열린범주로_옮기면_완료에픽이_진행중으로_다시열린다() {
    var e = epic(review);
    var c = child(e, deployed);
    issueService.updateStatus(owner, project.key(), e.number(), null, done);
    assertThat(issueRow(e.id()).get(ISSUE.STATUS)).isEqualTo("DONE");
    var epicVersion = issueRow(e.id()).get(ISSUE.VERSION);
    events.clear();

    delete(deployed, inProgress);

    var reopened = issueService.get(owner, project.key(), e.number()).summary();
    assertThat(reopened.status()).isEqualTo("IN_PROGRESS");
    assertThat(reopened.statusName()).isEqualTo("진행 중");
    assertThat(reopened.closedAt()).isNull();
    assertThat(issueRow(e.id()).get(ISSUE.VERSION)).isEqualTo(epicVersion);
    assertThat(history(e.id(), "STATUS_CHANGED")).last().isEqualTo("완료→진행 중");
    assertThat(issueRow(c.id()).get(ISSUE.STATUS)).isEqualTo("IN_PROGRESS");
    assertThat(events.stream(IssueStatusChangedEvent.class)).isEmpty();
  }

  @Test
  void 취소범주_삭제를_열린범주로_옮겨도_완료에픽이_다시열린다() {
    long onHold = addStatus("보류", "CANCELED");
    var e = epic(review);
    child(e, onHold);
    issueService.updateStatus(owner, project.key(), e.number(), null, done);

    delete(onHold, todo);

    var reopened = issueService.get(owner, project.key(), e.number()).summary();
    assertThat(reopened.status()).isEqualTo("IN_PROGRESS");
    assertThat(reopened.statusName()).isEqualTo("진행 중");
  }

  @Test
  void 완료범주끼리_이전은_완료에픽을_그대로_둔다() {
    var e = epic(review);
    child(e, deployed);
    issueService.updateStatus(owner, project.key(), e.number(), null, done);

    delete(deployed, done);

    assertThat(issueRow(e.id()).get(ISSUE.STATUS)).isEqualTo("DONE");
  }

  @Test
  void 저장된뷰의_statusId와_boardTab이_moveTo로_바뀐다() {
    create(review);
    Long other = createUser("sv");
    projectService.addMember(owner, project.key(), new AddMemberRequest(other, "MEMBER"));
    long mine = addView(owner, "내 뷰", "statusId=" + review + "%2C" + inProgress, "SHARED");
    long theirs = addView(other, "남의 뷰", "view=board&boardTab=" + review, "PRIVATE");
    long unrelated = addView(owner, "무관", "statusId=" + todo, "PRIVATE");

    delete(review, inProgress);

    assertThat(viewQuery(mine)).isEqualTo("statusId=" + inProgress);
    assertThat(viewQuery(theirs)).isEqualTo("view=board&boardTab=" + inProgress);
    assertThat(viewQuery(unrelated)).isEqualTo("statusId=" + todo);
    assertThat(meta(deleteLogs().get(0)).path("savedViewCount").asInt()).isEqualTo(2);
  }

  @Test
  void 이슈0개_삭제는_저장된뷰에서_id를_뺀다() {
    long a = addView(owner, "a", "statusId=" + review + "&q=x", "SHARED");
    long b = addView(owner, "b", "statusId=" + review + "," + todo, "SHARED");

    delete(review, null);

    assertThat(viewQuery(a)).isEqualTo("q=x");
    assertThat(viewQuery(b)).isEqualTo("statusId=" + todo);
  }

  @Test
  void statusId만_있던_뷰는_비지않고_기본뷰_쿼리로_남는다() {
    long only = addView(owner, "only", "statusId=" + review, "PRIVATE");

    delete(review, null);

    String q = viewQuery(only);
    // 빈 쿼리로 저장하면 이 뷰의 이름만 바꿔도 @NotBlank 로 400 이 난다 — 웹이 필터 없는 목록 뷰에 쓰는 「그룹 없음」 기본 쿼리로 남는다
    assertThat(q).isEqualTo("group=none");
    assertThat(validator.validate(new SaveViewRequest("only", q, "PRIVATE"))).isEmpty();
  }

  @Test
  void 삭제는_DELETE_감사로그를_남긴다() {
    create(review);
    create(review);

    delete(review, inProgress);

    var logs = deleteLogs();
    assertThat(logs).hasSize(1);
    var log = logs.get(0);
    assertThat(log.resourceId()).isEqualTo(String.valueOf(review));
    assertThat(log.userId()).isEqualTo(owner);
    var m = meta(log);
    assertThat(m.path("name").asText()).isEqualTo("검토 중");
    assertThat(m.path("moveTo").asText()).isEqualTo("진행 중");
    assertThat(m.path("movedIssueCount").asInt()).isEqualTo(2);
  }

  @Test
  void 실패한_삭제는_감사로그를_남기지_않는다() {
    create(review);

    assertThatThrownBy(() -> delete(review, null))
        .isInstanceOf(StatusMoveTargetRequiredException.class);

    assertThat(deleteLogs()).isEmpty();
  }

  @Test
  void deletion_impact는_활성이슈수_뷰수_차단에픽수() {
    var e = epic(review);
    child(e, todo);
    create(review);
    var trashed = create(review);
    issueService.softDelete(owner, project.key(), trashed.number());
    addView(owner, "v", "statusId=" + review, "PRIVATE");
    addView(owner, "w", "statusId=" + todo, "PRIVATE");

    StatusDeletionImpact impact = deletionService.impact(owner, project.key(), review);

    assertThat(impact.issueCount()).isEqualTo(2);
    assertThat(impact.savedViewCount()).isEqualTo(1);
    assertThat(impact.blockedEpicCount()).isEqualTo(1);
    assertThat(impact.emptiedFilterViewCount()).isEqualTo(1);
  }

  @Test
  void deletion_impact의_emptiedFilterViewCount는_statusId가_비는_뷰만_센다() {
    addView(owner, "only", "statusId=" + review + "&q=x", "SHARED");
    addView(owner, "mixed", "statusId=" + review + "%2C" + todo, "SHARED");
    addView(owner, "tab", "boardTab=" + review, "SHARED");

    var impact = deletionService.impact(owner, project.key(), review);

    assertThat(impact.issueCount()).isZero();
    assertThat(impact.savedViewCount()).isEqualTo(3);
    assertThat(impact.emptiedFilterViewCount()).isEqualTo(1);
    assertThat(impact.blockedEpicCount()).isZero();
  }

  @Test
  void MEMBER는_삭제가_403_개인프로젝트는_400() {
    Long member = createUser("sm");
    projectService.addMember(owner, project.key(), new AddMemberRequest(member, "MEMBER"));

    assertThatThrownBy(() -> deletionService.delete(member, project.key(), review, inProgress))
        .isInstanceOf(ProjectAccessDeniedException.class);

    var personal = personalProjectProvisioner.createPersonal(owner, "개인 작업", null, false);
    long personalInProgress =
        statusService.list(owner, personal.key()).stream()
            .filter(s -> s.name().equals("진행 중"))
            .findFirst()
            .orElseThrow()
            .id();
    assertThatThrownBy(
            () -> deletionService.delete(owner, personal.key(), personalInProgress, null))
        .isInstanceOf(StatusEditNotSupportedException.class);
  }

  @Test
  void groupCounts_필터없이_statusId별_활성이슈를_센다() {
    create(review);
    create(review);
    create(deployed);
    var trashed = create(review);
    issueService.softDelete(owner, project.key(), trashed.number());

    var counts =
        issueSearchService.groupCounts(owner, project.key(), Map.of("groupBy", "statusId"));

    var byId =
        counts.groups().stream()
            .collect(
                java.util.stream.Collectors.toMap(
                    g -> g.key(), g -> g.count(), (x, y) -> x, java.util.HashMap::new));
    // 설정 행의 이슈 수 근거 — 종료 상태도 숨기지 않고, 휴지통은 빼서 deletion-impact 와 같은 수
    assertThat(byId.get(String.valueOf(review)))
        .isEqualTo(deletionService.impact(owner, project.key(), review).issueCount())
        .isEqualTo(2);
    assertThat(byId.get(String.valueOf(deployed)))
        .isEqualTo(deletionService.impact(owner, project.key(), deployed).issueCount())
        .isEqualTo(1);
  }
}
