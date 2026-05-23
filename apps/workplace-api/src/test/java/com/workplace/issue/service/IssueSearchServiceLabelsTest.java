package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.repository.IssueRepository;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.service.LabelService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueSearchService 라벨 필터 + 라벨 응답 임베드 검증. */
@Transactional
class IssueSearchServiceLabelsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueLabelService issueLabelService;
  @Autowired LabelService labelService;
  @Autowired IssueRepository issueRepository;
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
  void label_csv_and_filter_keeps_only_issues_with_all() {
    Long owner = createUser("la");
    ProjectResponse p = newProject(owner, "LBL");
    var bug = labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));
    var docs = labelService.create(owner, p.key(), new CreateLabelRequest("문서", "BLUE"));

    issueRepository.insert(p.id(), 1, "with-both", null, "MID", null, owner, null);
    issueRepository.insert(p.id(), 2, "with-bug-only", null, "MID", null, owner, null);
    issueRepository.insert(p.id(), 3, "with-docs-only", null, "MID", null, owner, null);
    issueRepository.insert(p.id(), 4, "with-none", null, "MID", null, owner, null);

    issueLabelService.replace(owner, p.key(), 1, List.of(bug.id(), docs.id()));
    issueLabelService.replace(owner, p.key(), 2, List.of(bug.id()));
    issueLabelService.replace(owner, p.key(), 3, List.of(docs.id()));

    var resp = searchService.search(owner, p.key(), Map.of("label", bug.id() + "," + docs.id()));

    assertThat(resp.items()).hasSize(1);
    assertThat(resp.items().get(0).number()).isEqualTo(1);
    assertThat(resp.items().get(0).labels()).hasSize(2);
  }

  @Test
  void no_label_filter_returns_issues_with_their_labels_attached() {
    Long owner = createUser("lb");
    ProjectResponse p = newProject(owner, "LBM");
    var bug = labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner, null);
    issueLabelService.replace(owner, p.key(), 1, List.of(bug.id()));

    var resp = searchService.search(owner, p.key(), Map.of());

    assertThat(resp.items()).hasSize(1);
    assertThat(resp.items().get(0).labels()).hasSize(1);
    assertThat(resp.items().get(0).labels().get(0).name()).isEqualTo("버그");
  }
}
