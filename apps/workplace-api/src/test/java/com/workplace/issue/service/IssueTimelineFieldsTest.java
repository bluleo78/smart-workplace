package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.InvalidIssueDateRangeException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.milestone.exception.MilestoneNotFoundException;
import com.workplace.milestone.service.MilestoneService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 startDate/milestoneId 필드 통합 테스트 — 생성 반영, 부분수정 히스토리, clear 플래그, 기간 검증, 마일스톤 연결/격리/해제. (타임라인 간트뷰
 * Task 4)
 */
@Transactional
class IssueTimelineFieldsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired ProjectService projectService;
  @Autowired MilestoneService milestoneService;

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
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  @Test
  void create_with_start_date_persists_and_responds() {
    Long owner = createUser("a");
    ProjectResponse p = newProject(owner, "TL1");
    LocalDate start = LocalDate.of(2026, 7, 1);

    var issue =
        issueService.create(
            owner,
            p.key(),
            new CreateIssueRequest(
                "t", null, null, LocalDate.of(2026, 7, 10), null, null, null, start));

    assertThat(issue.startDate()).isEqualTo(start);
  }

  @Test
  void update_start_date_records_history() {
    Long owner = createUser("b");
    ProjectResponse p = newProject(owner, "TL2");
    var issue =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null, null));
    LocalDate start = LocalDate.of(2026, 7, 5);

    var updated =
        issueService.update(
            owner,
            p.key(),
            issue.number(),
            new UpdateIssueRequest(null, null, null, null, null, false, start, false, null, false));

    assertThat(updated.summary().startDate()).isEqualTo(start);
    assertThat(historyRepository.findByIssue(issue.id()))
        .anyMatch(
            h ->
                "START_DATE_CHANGED".equals(h.eventType())
                    && h.fromValue() == null
                    && start.toString().equals(h.toValue()));
  }

  @Test
  void clear_start_date_nulls_field() {
    Long owner = createUser("c");
    ProjectResponse p = newProject(owner, "TL3");
    LocalDate start = LocalDate.of(2026, 7, 5);
    var issue =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null, start));

    var updated =
        issueService.update(
            owner,
            p.key(),
            issue.number(),
            new UpdateIssueRequest(null, null, null, null, null, false, null, true, null, false));

    assertThat(updated.summary().startDate()).isNull();
  }

  @Test
  void start_after_due_throws_400() {
    Long owner = createUser("d");
    ProjectResponse p = newProject(owner, "TL4");
    LocalDate due = LocalDate.of(2026, 7, 1);
    var issue =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, due, null, null, null, null));
    LocalDate startAfterDue = due.plusDays(1);

    assertThatThrownBy(
            () ->
                issueService.update(
                    owner,
                    p.key(),
                    issue.number(),
                    new UpdateIssueRequest(
                        null, null, null, null, null, false, startAfterDue, false, null, false)))
        .isInstanceOf(InvalidIssueDateRangeException.class);
  }

  @Test
  void set_milestone_links_and_records_history() {
    Long owner = createUser("e");
    ProjectResponse p = newProject(owner, "TL5");
    var milestone =
        milestoneService.create(
            owner, p.key(), new CreateMilestoneRequest("M1", LocalDate.of(2026, 8, 1), null));
    var issue =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null, null));

    var updated =
        issueService.update(
            owner,
            p.key(),
            issue.number(),
            new UpdateIssueRequest(
                null, null, null, null, null, false, null, false, milestone.id(), false));

    assertThat(updated.summary().milestoneId()).isEqualTo(milestone.id());
    assertThat(historyRepository.findByIssue(issue.id()))
        .anyMatch(
            h ->
                "MILESTONE_CHANGED".equals(h.eventType())
                    && h.fromValue() == null
                    && "M1".equals(h.toValue()));
  }

  @Test
  void milestone_of_other_project_rejected() {
    Long owner = createUser("f");
    ProjectResponse p1 = newProject(owner, "TL6");
    ProjectResponse p2 = newProject(owner, "TL7");
    var milestoneOfP2 =
        milestoneService.create(
            owner, p2.key(), new CreateMilestoneRequest("M2", LocalDate.of(2026, 8, 1), null));
    var issue =
        issueService.create(
            owner, p1.key(), new CreateIssueRequest("t", null, null, null, null, null, null, null));

    assertThatThrownBy(
            () ->
                issueService.update(
                    owner,
                    p1.key(),
                    issue.number(),
                    new UpdateIssueRequest(
                        null,
                        null,
                        null,
                        null,
                        null,
                        false,
                        null,
                        false,
                        milestoneOfP2.id(),
                        false)))
        .isInstanceOf(MilestoneNotFoundException.class);
  }

  @Test
  void clear_milestone_unlinks() {
    Long owner = createUser("g");
    ProjectResponse p = newProject(owner, "TL8");
    var milestone =
        milestoneService.create(
            owner, p.key(), new CreateMilestoneRequest("M3", LocalDate.of(2026, 8, 1), null));
    var issue =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null, null));
    issueService.update(
        owner,
        p.key(),
        issue.number(),
        new UpdateIssueRequest(
            null, null, null, null, null, false, null, false, milestone.id(), false));

    var updated =
        issueService.update(
            owner,
            p.key(),
            issue.number(),
            new UpdateIssueRequest(null, null, null, null, null, false, null, false, null, true));

    assertThat(updated.summary().milestoneId()).isNull();
  }
}
