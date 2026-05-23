package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.exception.InvalidLabelForProjectException;
import com.workplace.label.service.LabelService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueLabelService 통합 테스트 — 집합 교체, 프로젝트 일관성, history 기록. */
@Transactional
class IssueLabelServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueLabelService issueLabelService;
  @Autowired LabelService labelService;
  @Autowired IssueRepository issueRepository;
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
  void replace_sets_labels_and_records_history() {
    Long owner = createUser("a");
    ProjectResponse p = newProject(owner, "IL");
    var l1 = labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));
    var l2 = labelService.create(owner, p.key(), new CreateLabelRequest("문서", "BLUE"));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    var result = issueLabelService.replace(owner, p.key(), 1, List.of(l1.id(), l2.id()));

    assertThat(result).hasSize(2);
    assertThat(historyRepository.findByIssue(issue.id()))
        .anyMatch(h -> h.eventType().equals("LABELS_CHANGED"));
  }

  @Test
  void replace_with_label_from_other_project_throws_400() {
    Long owner = createUser("b");
    ProjectResponse pa = newProject(owner, "ILA");
    ProjectResponse pb = newProject(owner, "ILB");
    var foreignLabel = labelService.create(owner, pb.key(), new CreateLabelRequest("버그", "RED"));
    issueRepository.insert(pa.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(
            () -> issueLabelService.replace(owner, pa.key(), 1, List.of(foreignLabel.id())))
        .isInstanceOf(InvalidLabelForProjectException.class);
  }

  @Test
  void replace_with_empty_list_removes_all() {
    Long owner = createUser("c");
    ProjectResponse p = newProject(owner, "ILC");
    var l = labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    issueLabelService.replace(owner, p.key(), 1, List.of(l.id()));

    var result = issueLabelService.replace(owner, p.key(), 1, List.of());

    assertThat(result).isEmpty();
  }

  @Test
  void no_diff_does_not_record_history() {
    Long owner = createUser("d");
    ProjectResponse p = newProject(owner, "ILD");
    var l = labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    issueLabelService.replace(owner, p.key(), 1, List.of(l.id()));
    int before = historyRepository.findByIssue(issue.id()).size();

    issueLabelService.replace(owner, p.key(), 1, List.of(l.id()));

    assertThat(historyRepository.findByIssue(issue.id())).hasSize(before);
  }
}
