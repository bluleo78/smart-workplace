package com.workplace.issue.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.exception.CompletedCycleNotAssignableException;
import com.workplace.cycle.exception.InvalidCycleForProjectException;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.repository.IssueCycleRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.exception.InvalidLabelForProjectException;
import com.workplace.label.exception.InvalidLabelNameException;
import com.workplace.label.service.LabelService;
import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.milestone.exception.MilestoneNotFoundException;
import com.workplace.milestone.service.MilestoneService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-356 — 이슈 생성 요청의 라벨·마일스톤·사이클. 생성과 같은 트랜잭션에서 붙고(원자적), 검증 실패는 이슈를 만들지 않으며, 수정 경로와 같은 권한 규칙(멤버만)을
 * 따른다.
 */
@Transactional
class IssueCreateWithMetaTest extends IntegrationTestBase {

  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired LabelService labelService;
  @Autowired MilestoneService milestoneService;
  @Autowired CycleService cycleService;
  @Autowired IssueCycleRepository issueCycleRepository;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueTypeService issueTypeService;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

  private Long ownerId;
  private String projectKey;
  private Long projectId;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    ownerId = createUser("meta-owner");
    projectKey = uniqueKey("CM");
    projectId =
        projectService
            .create(ownerId, new CreateProjectRequest(projectKey, "CreateMeta", "x"))
            .id();
  }

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
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    grantUserRole(id); // 실제 사용자처럼 label:manage 를 갖게 — 이름 라벨로 새 라벨을 만드는 경로가 이 권한을 본다(WP-394)
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return prefix + suffix;
  }

  /** 라벨·마일스톤·사이클만 지정한 생성 요청. */
  private static CreateIssueRequest withMeta(
      String title, List<Long> labelIds, Long milestoneId, List<Long> cycleIds) {
    return new CreateIssueRequest(
        title, null, null, null, null, null, null, null, labelIds, milestoneId, cycleIds, null);
  }

  @Test
  void create_attachesLabelsMilestoneAndCycles_inResponseAndDb() {
    var bug = labelService.create(ownerId, projectKey, new CreateLabelRequest("bug", "RED"));
    var ui = labelService.create(ownerId, projectKey, new CreateLabelRequest("ui", "BLUE"));
    var m1 =
        milestoneService.create(
            ownerId, projectKey, new CreateMilestoneRequest("M1", LocalDate.of(2026, 12, 1), null));
    var c1 =
        cycleService.create(
            ownerId, projectKey, new CreateCycleRequest("C1", null, null, null, null));

    var created =
        issueService.create(
            ownerId,
            projectKey,
            withMeta("with meta", List.of(bug.id(), ui.id()), m1.id(), List.of(c1.id())));

    // 응답에 라벨·마일스톤 이름이 실린다(생성 직후 호출자가 반영 여부를 확인할 수 있게).
    assertThat(created.labels()).extracting(l -> l.name()).containsExactlyInAnyOrder("bug", "ui");
    assertThat(created.milestoneName()).isEqualTo("M1");
    // DB 에 실제로 연결됐다.
    var detail = issueService.get(ownerId, projectKey, created.number());
    assertThat(detail.summary().labels()).hasSize(2);
    assertThat(detail.summary().milestoneId()).isEqualTo(m1.id());
    assertThat(issueCycleRepository.findCycleIdsByIssue(created.id())).containsExactly(c1.id());
  }

  @Test
  void create_labelOfOtherProject_failsWithoutCreatingIssue() {
    String otherKey = uniqueKey("CO");
    projectService.create(ownerId, new CreateProjectRequest(otherKey, "Other", "x"));
    var foreign = labelService.create(ownerId, otherKey, new CreateLabelRequest("x", "RED"));

    assertThatThrownBy(
            () ->
                issueService.create(
                    ownerId, projectKey, withMeta("bad", List.of(foreign.id()), null, null)))
        .isInstanceOf(InvalidLabelForProjectException.class);
    assertThat(issueRepository.countByProject(projectId)).isZero();
  }

  @Test
  void create_cycleOfOtherProject_fails() {
    String otherKey = uniqueKey("CO");
    projectService.create(ownerId, new CreateProjectRequest(otherKey, "Other", "x"));
    var foreign =
        cycleService.create(ownerId, otherKey, new CreateCycleRequest("C", null, null, null, null));

    assertThatThrownBy(
            () ->
                issueService.create(
                    ownerId, projectKey, withMeta("bad", null, null, List.of(foreign.id()))))
        .isInstanceOf(InvalidCycleForProjectException.class);
    assertThat(issueRepository.countByProject(projectId)).isZero();
  }

  // WP-659: 새 이슈도 완료 사이클에는 넣을 수 없다 — 피커·보드 드래그와 같은 규칙.
  @Test
  void create_withCompletedCycle_fails() {
    var done =
        cycleService.create(
            ownerId, projectKey, new CreateCycleRequest("Done", null, null, null, "COMPLETED"));

    assertThatThrownBy(
            () ->
                issueService.create(
                    ownerId, projectKey, withMeta("late", null, null, List.of(done.id()))))
        .isInstanceOf(CompletedCycleNotAssignableException.class);
    assertThat(issueRepository.countByProject(projectId)).isZero();
  }

  @Test
  void create_milestoneOfOtherProject_fails() {
    String otherKey = uniqueKey("CO");
    projectService.create(ownerId, new CreateProjectRequest(otherKey, "Other", "x"));
    var foreign =
        milestoneService.create(
            ownerId, otherKey, new CreateMilestoneRequest("M", LocalDate.of(2026, 12, 1), null));

    assertThatThrownBy(
            () ->
                issueService.create(ownerId, projectKey, withMeta("bad", null, foreign.id(), null)))
        .isInstanceOf(MilestoneNotFoundException.class);
    assertThat(issueRepository.countByProject(projectId)).isZero();
  }

  /** 사전검증(확인 카드 dry-run)도 같은 술어를 쓴다 — 다른 프로젝트 라벨은 승인 전에 드러난다. */
  @Test
  void validateCreatable_rejectsForeignLabel() {
    String otherKey = uniqueKey("CO");
    projectService.create(ownerId, new CreateProjectRequest(otherKey, "Other", "x"));
    var foreign = labelService.create(ownerId, otherKey, new CreateLabelRequest("x", "RED"));

    assertThatThrownBy(
            () ->
                issueService.validateCreatable(
                    ownerId, projectKey, withMeta("bad", List.of(foreign.id()), null, null)))
        .isInstanceOf(InvalidLabelForProjectException.class);
  }

  /** OPEN 프로젝트 비멤버는 이슈는 만들 수 있지만 라벨·마일스톤·사이클은 지정할 수 없다(수정 경로와 같은 규칙). */
  @Test
  void create_openProjectNonMember_withLabels_isDenied() {
    var s = OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    var label =
        labelService.create(s.ownerId(), s.projectKey(), new CreateLabelRequest("l", "RED"));

    assertThatThrownBy(
            () ->
                issueService.create(
                    s.strangerId(), s.projectKey(), withMeta("x", List.of(label.id()), null, null)))
        .isInstanceOf(ProjectAccessDeniedException.class);
    // 라벨 없이는 그대로 만들 수 있다.
    assertThat(issueService.create(s.strangerId(), s.projectKey(), withMeta("y", null, null, null)))
        .isNotNull();
  }

  /** 우선순위·날짜·담당자·유형·부모만 지정한 생성 요청(WP-477). */
  private static CreateIssueRequest withFields(
      String priority,
      LocalDate startDate,
      LocalDate dueDate,
      List<Long> assigneeIds,
      Long typeId,
      Integer parentNumber) {
    return new CreateIssueRequest(
        "x",
        null,
        priority,
        dueDate,
        assigneeIds,
        typeId,
        parentNumber,
        startDate,
        null,
        null,
        null,
        null);
  }

  /**
   * WP-477 — OPEN 프로젝트 비멤버는 우선순위·시작일·마감일·담당자·유형·부모도 지정할 수 없다(수정 경로에서 멤버 전용인 값). 생성이 그 변경의 우회로가 되면 안
   * 된다. 기본값(우선순위 MID·유형 TASK)이나 빈 담당자 목록은 지정하지 않은 것과 같아 받아 준다.
   */
  @Test
  void create_openProjectNonMember_withMemberOnlyFields_isDenied() {
    var s = OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    Long taskId = typeIdOf(s.project().id(), "TASK");
    Long bugId = typeIdOf(s.project().id(), "BUG");
    LocalDate day = LocalDate.of(2026, 10, 20);

    for (var req :
        List.of(
            withFields("HIGH", null, null, null, null, null),
            withFields("LOW", null, null, null, null, null),
            withFields(null, day, null, null, null, null),
            withFields(null, null, day, null, null, null),
            withFields(null, null, null, List.of(s.ownerId()), null, null),
            withFields(null, null, null, null, bugId, null),
            withFields(null, null, null, null, null, s.issueNumber()))) {
      assertThatThrownBy(() -> issueService.create(s.strangerId(), s.projectKey(), req))
          .isInstanceOf(ProjectAccessDeniedException.class);
    }
    // 기본값과 같은 값은 지정하지 않은 것과 같다.
    assertThat(
            issueService.create(
                s.strangerId(),
                s.projectKey(),
                withFields("MID", null, null, List.of(), taskId, null)))
        .isNotNull();
    // 멤버는 그대로 지정할 수 있다.
    assertThat(
            issueService.create(
                s.memberId(), s.projectKey(), withFields("HIGH", day, day, null, bugId, null)))
        .isNotNull();
  }

  private Long typeIdOf(Long pid, String name) {
    return dsl.select(ISSUE_TYPE_DEF.ID)
        .from(ISSUE_TYPE_DEF)
        .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(pid), ISSUE_TYPE_DEF.NAME.eq(name))
        .fetchOne(ISSUE_TYPE_DEF.ID);
  }

  /** 처음 상태만 지정한 생성 요청(WP-464). */
  private static CreateIssueRequest withStatus(String title, String status) {
    return new CreateIssueRequest(
        title, null, null, null, null, null, null, null, null, null, null, null, null, status);
  }

  /** WP-464 — 보드 컬럼의 「이슈 추가」처럼 처음 상태를 지정해 만든다. 종료 상태면 closed_at 도 채운다. 미지정은 할 일. */
  @Test
  void create_withStatus_setsInitialStatusAndClosedAt() {
    var inProgress = issueService.create(ownerId, projectKey, withStatus("a", "IN_PROGRESS"));
    var done = issueService.create(ownerId, projectKey, withStatus("b", "DONE"));
    var plain = issueService.create(ownerId, projectKey, withStatus("c", null));

    assertThat(inProgress.status()).isEqualTo("IN_PROGRESS");
    assertThat(done.status()).isEqualTo("DONE");
    assertThat(plain.status()).isEqualTo("TODO");
    assertThat(issueRepository.findById(inProgress.id()).orElseThrow().closedAt()).isNull();
    assertThat(issueRepository.findById(done.id()).orElseThrow().closedAt()).isNotNull();
  }

  /** WP-464 — 처음 상태도 상태 변경처럼 멤버 전용: OPEN 비멤버는 할 일 외 상태를 지정할 수 없다(WP-477 규칙). */
  @Test
  void create_openProjectNonMember_withStatus_isDenied() {
    var s = OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);

    assertThatThrownBy(
            () -> issueService.create(s.strangerId(), s.projectKey(), withStatus("x", "DONE")))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThat(issueService.create(s.strangerId(), s.projectKey(), withStatus("y", "TODO")))
        .isNotNull();
  }

  /** 같은 id 를 두 번 줘도 한 번만 붙는다(소속 검증의 개수 비교가 어긋나지 않는다). */
  @Test
  void create_duplicateLabelIds_attachOnce() {
    var bug = labelService.create(ownerId, projectKey, new CreateLabelRequest("bug", "RED"));

    var created =
        issueService.create(
            ownerId, projectKey, withMeta("dup", List.of(bug.id(), bug.id()), null, null));

    assertThat(created.labels()).hasSize(1);
  }

  /** 이름 라벨만 지정한 생성 요청(WP-394). */
  private static CreateIssueRequest withLabelNames(
      String title, List<Long> labelIds, List<String> labelNames, Integer parentNumber) {
    return new CreateIssueRequest(
        title, null, null, null, null, null, parentNumber, null, labelIds, null, null, labelNames);
  }

  /** WP-394 — 이름 라벨: 있는 이름은 그대로, 없는 이름은 기본 색으로 만들어 id 라벨과 함께 붙인다. 만든 사람은 요청자. */
  @Test
  void create_withLabelNames_createsMissingAndAttachesAll() {
    var bug = labelService.create(ownerId, projectKey, new CreateLabelRequest("bug", "RED"));

    var created =
        issueService.create(
            ownerId,
            projectKey,
            withLabelNames("named", List.of(bug.id()), List.of(" ai-fix ", "bug", "ai-fix"), null));

    assertThat(created.labels())
        .extracting(l -> l.name())
        .containsExactlyInAnyOrder("bug", "ai-fix");
    var aiFix =
        dsl.selectFrom(LABEL)
            .where(LABEL.PROJECT_ID.eq(projectId).and(LABEL.NAME.eq("ai-fix")))
            .fetchOne();
    assertThat(aiFix.getColorToken()).isEqualTo("GRAY");
    assertThat(aiFix.getCreatedBy()).isEqualTo(ownerId);
    // 라벨은 프로젝트에 하나씩만 생긴다.
    assertThat(dsl.fetchCount(LABEL, LABEL.PROJECT_ID.eq(projectId))).isEqualTo(2);
  }

  /** WP-394 — 이슈 생성이 검증에서 실패하면 이름 라벨도 만들지 않는다(고아 라벨 없음). */
  @Test
  void create_withLabelNames_failingCreate_leavesNoLabel() {
    assertThatThrownBy(
            () ->
                issueService.create(
                    ownerId, projectKey, withLabelNames("bad", null, List.of("orphan"), 999)))
        .isInstanceOf(RuntimeException.class);
    assertThat(dsl.fetchCount(LABEL, LABEL.PROJECT_ID.eq(projectId))).isZero();
    assertThat(issueRepository.countByProject(projectId)).isZero();
  }

  /** WP-394 — 빈 이름·40자 초과는 400(IllegalArgumentException 계열)이고 사전검증에서도 드러난다. */
  @Test
  void validateCreatable_rejectsBlankOrTooLongLabelName() {
    assertThatThrownBy(
            () ->
                issueService.validateCreatable(
                    ownerId, projectKey, withLabelNames("x", null, List.of("  "), null)))
        .isInstanceOf(InvalidLabelNameException.class);
    assertThatThrownBy(
            () ->
                issueService.validateCreatable(
                    ownerId, projectKey, withLabelNames("x", null, List.of("a".repeat(41)), null)))
        .isInstanceOf(InvalidLabelNameException.class);
    assertThat(dsl.fetchCount(LABEL, LABEL.PROJECT_ID.eq(projectId))).isZero();
  }

  /** WP-750 — 이름 라벨도 라벨 생성 API 처럼 한 줄로 다듬는다: 제로폭 문자뿐인 이름은 빈 이름으로 거절, 줄바꿈은 공백 하나로. */
  @Test
  void create_withLabelNames_normalizesLikeLabelCreate() {
    assertThatThrownBy(
            () ->
                issueService.create(
                    ownerId, projectKey, withLabelNames("zw", null, List.of("\u200B"), null)))
        .isInstanceOf(InvalidLabelNameException.class)
        .hasMessageContaining("비어 있습니다");
    assertThat(dsl.fetchCount(LABEL, LABEL.PROJECT_ID.eq(projectId))).isZero();

    var created =
        issueService.create(
            ownerId,
            projectKey,
            withLabelNames("nl", null, List.of("\u200Bai\nfix\uFEFF", "ai fix"), null));
    // 다듬으면 같은 이름이 되므로 라벨은 하나만 생긴다.
    assertThat(created.labels()).extracting(l -> l.name()).containsExactly("ai fix");
    assertThat(dsl.fetchCount(LABEL, LABEL.PROJECT_ID.eq(projectId))).isEqualTo(1);
  }

  /** WP-750 — 한 요청의 이름 라벨은 20개까지. 넘으면 라벨을 하나도 만들지 않고 400. */
  @Test
  void create_withTooManyLabelNames_isRejectedWithoutCreatingLabels() {
    var names = java.util.stream.IntStream.range(0, 21).mapToObj(i -> "n" + i).toList();
    assertThatThrownBy(
            () ->
                issueService.create(ownerId, projectKey, withLabelNames("many", null, names, null)))
        .isInstanceOf(InvalidLabelNameException.class)
        .hasMessageContaining("20개");
    assertThat(dsl.fetchCount(LABEL, LABEL.PROJECT_ID.eq(projectId))).isZero();
    assertThat(issueRepository.countByProject(projectId)).isZero();

    var ok =
        issueService.create(
            ownerId, projectKey, withLabelNames("twenty", null, names.subList(0, 20), null));
    assertThat(ok.labels()).hasSize(20);
  }

  /** WP-394 — OPEN 프로젝트 비멤버는 이름 라벨로도 라벨을 만들거나 붙일 수 없다. */
  @Test
  void create_openProjectNonMember_withLabelNames_isDenied() {
    var s = OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);

    assertThatThrownBy(
            () ->
                issueService.create(
                    s.strangerId(),
                    s.projectKey(),
                    withLabelNames("x", null, List.of("new"), null)))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  /** WP-394 — label:manage 가 없는 멤버는 이름으로 기존 라벨은 붙일 수 있지만 새 라벨은 만들 수 없다(라벨 관리 권한 우회 방지). */
  @Test
  void create_withLabelNames_withoutLabelManage_canAttachExistingButNotCreate() {
    labelService.create(ownerId, projectKey, new CreateLabelRequest("bug", "RED"));
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long plain =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "plain-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "plain")
            .set(USER.EMAIL, "plain-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, plain)
        .set(PROJECT_MEMBER.ROLE, "MEMBER")
        .execute();

    var created =
        issueService.create(plain, projectKey, withLabelNames("ok", null, List.of("bug"), null));
    assertThat(created.labels()).extracting(l -> l.name()).containsExactly("bug");

    assertThatThrownBy(
            () ->
                issueService.create(
                    plain, projectKey, withLabelNames("no", null, List.of("new-one"), null)))
        .isInstanceOf(ProjectAccessDeniedException.class)
        .hasMessageContaining("new-one");
    assertThat(dsl.fetchCount(LABEL, LABEL.PROJECT_ID.eq(projectId))).isEqualTo(1);
  }
}
