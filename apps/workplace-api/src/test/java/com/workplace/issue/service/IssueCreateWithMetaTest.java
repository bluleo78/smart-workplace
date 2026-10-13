package com.workplace.issue.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.exception.InvalidCycleForProjectException;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.repository.IssueCycleRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.exception.InvalidLabelForProjectException;
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
        title, null, null, null, null, null, null, null, labelIds, milestoneId, cycleIds);
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

  /** 같은 id 를 두 번 줘도 한 번만 붙는다(소속 검증의 개수 비교가 어긋나지 않는다). */
  @Test
  void create_duplicateLabelIds_attachOnce() {
    var bug = labelService.create(ownerId, projectKey, new CreateLabelRequest("bug", "RED"));

    var created =
        issueService.create(
            ownerId, projectKey, withMeta("dup", List.of(bug.id(), bug.id()), null, null));

    assertThat(created.labels()).hasSize(1);
  }
}
