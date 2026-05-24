package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.dto.UpdateIssueFieldsRequest;
import com.workplace.issue.dto.UpdateIssueFieldsRequest.FieldValueInput;
import com.workplace.issue.repository.IssueRepository;
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

/** Phase 4c — IssueSearchService 의 fieldId/fieldValue 동등 비교 필터 + customFields 응답 batch. */
@Transactional
class IssueSearchServiceFieldFilterTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueSearchService searchService;
  @Autowired IssueFieldDefService defService;
  @Autowired IssueFieldValueService valueService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;
  @Autowired ObjectMapper om;

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
  void field_filter_returns_matching_issue() {
    Long owner = createUser("a");
    var p = newProject(owner, "SFA");
    var d = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("n", "NUMBER", null));
    issueRepository.insert(p.id(), 1, "match", null, "MID", null, owner);
    issueRepository.insert(p.id(), 2, "no-match", null, "MID", null, owner);
    valueService.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(d.id(), om.valueToTree(5)))));
    valueService.replace(
        owner,
        p.key(),
        2,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(d.id(), om.valueToTree(9)))));

    var result =
        searchService.search(
            owner, p.key(), Map.of("fieldId", d.id().toString(), "fieldValue", "5"));

    assertThat(result.items()).hasSize(1);
    assertThat(result.items().get(0).number()).isEqualTo(1);
  }

  @Test
  void search_response_embeds_custom_fields_batch() {
    Long owner = createUser("b");
    var p = newProject(owner, "SFB");
    var d = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("t", "TEXT", null));
    issueRepository.insert(p.id(), 1, "a", null, "MID", null, owner);
    issueRepository.insert(p.id(), 2, "b", null, "MID", null, owner);
    valueService.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(d.id(), om.valueToTree("v1")))));

    var result = searchService.search(owner, p.key(), Map.of());

    assertThat(result.items()).hasSize(2);
    var byNumber =
        result.items().stream().collect(java.util.stream.Collectors.toMap(i -> i.number(), i -> i));
    assertThat(byNumber.get(1).customFields()).hasSize(1);
    assertThat(byNumber.get(1).customFields().get(0).name()).isEqualTo("t");
    assertThat(byNumber.get(2).customFields()).isEmpty();
  }

  @Test
  void filter_other_field_id_does_not_match() {
    Long owner = createUser("c");
    var p = newProject(owner, "SFC");
    var d1 = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("a", "TEXT", null));
    var d2 = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("b", "TEXT", null));
    issueRepository.insert(p.id(), 1, "i1", null, "MID", null, owner);
    valueService.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(d1.id(), om.valueToTree("v")))));

    var result =
        searchService.search(
            owner, p.key(), Map.of("fieldId", d2.id().toString(), "fieldValue", "v"));

    assertThat(result.items()).isEmpty();
  }
}
