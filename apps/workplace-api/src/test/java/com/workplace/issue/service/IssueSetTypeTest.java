package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.issue.exception.InvalidTypeForProjectException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueService.setType 통합 테스트 — 같은 프로젝트 검증, fast-return, history 기록, 권한. */
@Transactional
class IssueSetTypeTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired IssueTypeService typeService;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired ProjectService projectService;

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
  void member_changes_type_records_history() {
    Long owner = createUser("a");
    ProjectResponse p = newProject(owner, "ST1");
    var bug = typeRepository.findByProjectAndName(p.id(), "BUG").orElseThrow();
    var issue =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null));

    issueService.setType(owner, p.key(), issue.number(), bug.id());

    assertThat(historyRepository.findByIssue(issue.id()))
        .anyMatch(h -> "TYPE_CHANGED".equals(h.eventType()));
  }

  @Test
  void same_type_does_not_record() {
    Long owner = createUser("b");
    ProjectResponse p = newProject(owner, "ST2");
    var task = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow();
    var issue =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null));
    long before =
        historyRepository.findByIssue(issue.id()).stream()
            .filter(h -> "TYPE_CHANGED".equals(h.eventType()))
            .count();

    issueService.setType(owner, p.key(), issue.number(), task.id());

    long after =
        historyRepository.findByIssue(issue.id()).stream()
            .filter(h -> "TYPE_CHANGED".equals(h.eventType()))
            .count();
    assertThat(after).isEqualTo(before);
  }

  @Test
  void foreign_type_throws_400() {
    Long owner = createUser("c");
    ProjectResponse pa = newProject(owner, "ST3A");
    ProjectResponse pb = newProject(owner, "ST3B");
    var foreignType =
        typeService.create(owner, pb.key(), new CreateIssueTypeRequest("디자인", "PURPLE", "Star"));
    var issue =
        issueService.create(
            owner, pa.key(), new CreateIssueRequest("t", null, null, null, null, null, null));

    assertThatThrownBy(
            () -> issueService.setType(owner, pa.key(), issue.number(), foreignType.id()))
        .isInstanceOf(InvalidTypeForProjectException.class);
  }

  @Test
  void non_member_forbidden() {
    Long owner = createUser("d");
    Long stranger = createUser("d-stranger");
    ProjectResponse p = newProject(owner, "ST4");
    var bug = typeRepository.findByProjectAndName(p.id(), "BUG").orElseThrow();
    var issue =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, null, null));

    assertThatThrownBy(() -> issueService.setType(stranger, p.key(), issue.number(), bug.id()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void create_with_explicit_type_uses_it() {
    Long owner = createUser("e");
    ProjectResponse p = newProject(owner, "ST5");
    var bug = typeRepository.findByProjectAndName(p.id(), "BUG").orElseThrow();

    var issue =
        issueService.create(
            owner, p.key(), new CreateIssueRequest("t", null, null, null, null, bug.id(), null));
    var detail = issueService.get(owner, p.key(), issue.number());

    assertThat(detail.summary().type()).isNotNull();
    assertThat(detail.summary().type().name()).isEqualTo("BUG");
  }

  @Test
  void create_with_foreign_type_throws_400() {
    Long owner = createUser("f");
    ProjectResponse pa = newProject(owner, "ST6A");
    ProjectResponse pb = newProject(owner, "ST6B");
    var foreignType =
        typeService.create(owner, pb.key(), new CreateIssueTypeRequest("디자인", "PURPLE", "Star"));

    assertThatThrownBy(
            () ->
                issueService.create(
                    owner,
                    pa.key(),
                    new CreateIssueRequest("t", null, null, null, null, foreignType.id(), null)))
        .isInstanceOf(InvalidTypeForProjectException.class);
  }
}
