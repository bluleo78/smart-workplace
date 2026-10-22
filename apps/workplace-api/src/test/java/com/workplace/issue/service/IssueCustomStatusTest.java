package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.issue.dto.RenameProjectStatusRequest;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.EpicHasIncompleteChildrenException;
import com.workplace.issue.exception.InvalidStatusForProjectException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 상태를 프로젝트 상태 id 로 바꾸기(WP-807) 통합 테스트. 픽스처 프로젝트는 기본 4상태에 「검토 중」·「QA 대기」(진행 중 범주)·「배포됨」(완료 범주)을
 * 더해 둔다. 종료 시각·에픽 차단·AI 작업 종료는 범주로, 이력·이벤트는 상태 id 로 판정하는지 본다.
 */
@Transactional
@RecordApplicationEvents
class IssueCustomStatusTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired ProjectStatusService statusService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired ApplicationEvents events;

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
        ownerId, new CreateProjectRequest(prefix + suffix, "P-" + prefix, "x"));
  }

  private long statusId(ProjectResponse p, String name) {
    return statusService.list(owner, p.key()).stream()
        .filter(s -> s.name().equals(name))
        .findFirst()
        .map(ProjectStatusResponse::id)
        .orElseThrow();
  }

  private long addStatus(String name, String category) {
    return statusService
        .create(owner, project.key(), new CreateProjectStatusRequest(name, category, null))
        .id();
  }

  @BeforeEach
  void seed() {
    owner = createUser("cs");
    project = newProject(owner, "CS");
    todo = statusId(project, "할 일");
    inProgress = statusId(project, "진행 중");
    done = statusId(project, "완료");
    review = addStatus("검토 중", "IN_PROGRESS");
    addStatus("QA 대기", "IN_PROGRESS");
    deployed = addStatus("배포됨", "DONE");
  }

  /** 상태 지정 없이(또는 범주·상태 id 로) 이슈를 만든다. */
  private IssueResponse create(String status, Long statusId) {
    return issueService.create(owner, project.key(), request("t", null, null, status, statusId));
  }

  private static CreateIssueRequest request(
      String title, Long typeId, Integer parentNumber, String status, Long statusId) {
    return new CreateIssueRequest(
        title,
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
        status,
        statusId);
  }

  private IssueResponse moveTo(int number, long statusId) {
    return issueService.updateStatusById(owner, project.key(), number, statusId).summary();
  }

  private IssueResponse moveToCategory(int number, String category) {
    return issueService.updateStatus(owner, project.key(), number, category).summary();
  }

  private List<String> statusHistory(long issueId) {
    return dsl.select(ISSUE_HISTORY.FROM_VALUE, ISSUE_HISTORY.TO_VALUE)
        .from(ISSUE_HISTORY)
        .where(ISSUE_HISTORY.ISSUE_ID.eq(issueId))
        .and(ISSUE_HISTORY.EVENT_TYPE.eq("STATUS_CHANGED"))
        .orderBy(ISSUE_HISTORY.ID.asc())
        .fetch(r -> r.value1() + "→" + r.value2());
  }

  private long typeId(String name) {
    return typeRepository.findByProjectAndName(project.id(), name).orElseThrow().id();
  }

  /** 진행 중 AI 작업 하나를 직접 시드한다(작업자는 이슈 소유자로 충분 — 종료 판정은 이슈 단위). */
  private void seedWorking(long issueId) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, owner)
        .set(AGENT_WORK.TOOL, "claude-code")
        .set(AGENT_WORK.STATE, "WORKING")
        .set(AGENT_WORK.UPDATED_AT, OffsetDateTime.now())
        .execute();
  }

  private List<String> workStates(long issueId) {
    return dsl.select(AGENT_WORK.STATE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .orderBy(AGENT_WORK.ID.asc())
        .fetch(AGENT_WORK.STATE);
  }

  private int activeWorkCount(long issueId) {
    return dsl.fetchCount(
        AGENT_WORK, AGENT_WORK.ISSUE_ID.eq(issueId).and(AGENT_WORK.ENDED_AT.isNull()));
  }

  @Test
  void 새이슈는_할일_기본상태로_만들어진다() {
    var issue = create(null, null);

    assertThat(issue.statusId()).isEqualTo(todo);
    assertThat(issue.statusName()).isEqualTo("할 일");
    assertThat(issue.status()).isEqualTo("TODO");
  }

  @Test
  void 생성시_statusId를_주면_범주도_함께_정해진다() {
    var issue = create(null, review);

    assertThat(issue.statusId()).isEqualTo(review);
    assertThat(issue.statusName()).isEqualTo("검토 중");
    assertThat(issue.status()).isEqualTo("IN_PROGRESS");
  }

  @Test
  void statusId로_DONE범주_진입시_closedAt이_찍힌다() {
    var issue = create(null, null);

    var after = moveTo(issue.number(), deployed);

    assertThat(after.status()).isEqualTo("DONE");
    assertThat(after.statusName()).isEqualTo("배포됨");
    assertThat(after.closedAt()).isNotNull();
  }

  @Test
  void 같은범주_안_이동은_closedAt을_바꾸지_않는다() {
    var closed = create(null, done);
    var closedAt = moveTo(closed.number(), done).closedAt();
    assertThat(closedAt).isNotNull();

    assertThat(moveTo(closed.number(), deployed).closedAt()).isEqualTo(closedAt);

    var open = create("IN_PROGRESS", null);
    assertThat(moveTo(open.number(), review).closedAt()).isNull();
  }

  @Test
  void 같은범주_안_이동도_이력과_이벤트가_남는다() {
    var issue = create("IN_PROGRESS", null);
    events.clear();

    moveTo(issue.number(), review);

    assertThat(statusHistory(issue.id())).containsExactly("진행 중→검토 중");
    assertThat(events.stream(IssueStatusChangedEvent.class))
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.previousStatus()).isEqualTo("IN_PROGRESS");
              assertThat(e.newStatus()).isEqualTo("IN_PROGRESS");
              assertThat(e.previousStatusName()).isEqualTo("진행 중");
              assertThat(e.newStatusName()).isEqualTo("검토 중");
            });
  }

  @Test
  void 범주값만_보내면_그범주_기본상태로_간다() {
    var issue = create(null, null);

    var after = moveToCategory(issue.number(), "DONE");

    assertThat(after.statusId()).isEqualTo(done);
    assertThat(after.statusName()).isEqualTo("완료");
  }

  @Test
  void 이미_그범주면_범주값_요청은_상태를_유지한다() {
    var issue = create(null, review);
    events.clear();

    var after = moveToCategory(issue.number(), "IN_PROGRESS");

    assertThat(after.statusId()).isEqualTo(review);
    assertThat(after.statusName()).isEqualTo("검토 중");
    assertThat(statusHistory(issue.id())).isEmpty();
    assertThat(events.stream(IssueStatusChangedEvent.class)).isEmpty();
  }

  @Test
  void 다른프로젝트_statusId는_400() {
    var other = newProject(owner, "CX");
    long foreign = statusId(other, "진행 중");
    var issue = create(null, null);

    assertThatThrownBy(() -> moveTo(issue.number(), foreign))
        .isInstanceOf(InvalidStatusForProjectException.class);
    assertThatThrownBy(() -> create(null, foreign))
        .isInstanceOf(InvalidStatusForProjectException.class);
  }

  @Test
  void statusId와_status가_어긋나면_statusId가_이긴다() {
    var issue = create(null, null);

    var after =
        issueService
            .update(
                owner,
                project.key(),
                issue.number(),
                new UpdateIssueRequest(
                    null, null, "TODO", null, null, null, null, null, null, null, null, deployed))
            .summary();

    assertThat(after.status()).isEqualTo("DONE");
    assertThat(after.statusName()).isEqualTo("배포됨");
    // 생성도 같은 규칙
    assertThat(create("TODO", deployed).status()).isEqualTo("DONE");
  }

  @Test
  void 에픽은_사용자정의_DONE상태로도_미완료하위가_있으면_차단된다() {
    var epic =
        issueService.create(owner, project.key(), request("e", typeId("EPIC"), null, null, null));
    issueService.create(owner, project.key(), request("c", null, epic.number(), null, null));

    assertThatThrownBy(() -> moveTo(epic.number(), deployed))
        .isInstanceOf(EpicHasIncompleteChildrenException.class);
  }

  @Test
  void 에픽_재오픈은_진행중_기본상태로_간다() {
    var epic =
        issueService.create(owner, project.key(), request("e", typeId("EPIC"), null, null, null));
    var child =
        issueService.create(owner, project.key(), request("c", null, epic.number(), null, null));
    moveToCategory(child.number(), "DONE");
    assertThat(moveTo(epic.number(), deployed).statusName()).isEqualTo("배포됨");

    // 하위를 다시 열면 완료 에픽도 진행 중 범주의 기본 상태로 되돌아간다.
    moveToCategory(child.number(), "TODO");

    var reopened = issueService.get(owner, project.key(), epic.number()).summary();
    assertThat(reopened.status()).isEqualTo("IN_PROGRESS");
    assertThat(reopened.statusName()).isEqualTo("진행 중");
  }

  @Test
  void 사용자정의_CANCELED_범주_진입시_AI작업이_취소된다() {
    long onHold = addStatus("보류", "CANCELED");
    var issue = create(null, null);
    seedWorking(issue.id());

    moveTo(issue.number(), onHold);

    assertThat(activeWorkCount(issue.id())).isZero();
    assertThat(workStates(issue.id())).containsExactly("CANCELED");
  }

  @Test
  void 같은_DONE범주_안_이동은_AI작업_종료를_다시_부르지_않는다() {
    var issue = create(null, null);
    moveTo(issue.number(), done);
    // 완료 뒤에 남은 진행 중 작업 — 같은 범주 안 이동이 종료를 다시 부르면 닫힌다.
    seedWorking(issue.id());

    moveTo(issue.number(), deployed);

    assertThat(activeWorkCount(issue.id())).isEqualTo(1);
  }

  @Test
  void 이름을_바꿔도_예전_응답코드_status는_그대로다() {
    var issue = create("IN_PROGRESS", null);

    statusService.rename(owner, project.key(), inProgress, new RenameProjectStatusRequest("작업 중"));

    var after = issueService.get(owner, project.key(), issue.number()).summary();
    assertThat(after.status()).isEqualTo("IN_PROGRESS");
    assertThat(after.statusName()).isEqualTo("작업 중");
  }

  @Test
  void create_응답에_statusName이_채워진다() {
    var issue = create("DONE", null);

    assertThat(issue.statusId()).isEqualTo(done);
    assertThat(issue.statusName()).isEqualTo("완료");
  }
}
