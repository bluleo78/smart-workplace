package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import com.workplace.issue.dto.CreateIssueFieldDefRequest;
import com.workplace.issue.dto.UpdateIssueFieldsRequest;
import com.workplace.issue.dto.UpdateIssueFieldsRequest.FieldValueInput;
import com.workplace.issue.exception.InvalidFieldForProjectException;
import com.workplace.issue.exception.InvalidFieldValueException;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
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

/** IssueFieldValueService — PUT 집합 변경, diff history, 검증. */
@Transactional
class IssueFieldValueServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueFieldValueService service;
  @Autowired IssueFieldDefService defService;
  @Autowired IssueFieldValueRepository valueRepo;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueHistoryRepository historyRepository;
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
  void put_three_values_records_three_history() {
    Long owner = createUser("a");
    var p = newProject(owner, "VSA");
    var d1 = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("t", "TEXT", null));
    var d2 = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("n", "NUMBER", null));
    var d3 = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("dt", "DATE", null));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    service.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(
            List.of(
                new FieldValueInput(d1.id(), om.valueToTree("hi")),
                new FieldValueInput(d2.id(), om.valueToTree(5)),
                new FieldValueInput(d3.id(), om.valueToTree("2026-06-01")))));

    long count =
        historyRepository.findByIssue(issue.id()).stream()
            .filter(h -> "CUSTOM_FIELD_CHANGED".equals(h.eventType()))
            .count();
    assertThat(count).isEqualTo(3);
  }

  @Test
  void put_same_set_records_no_history() {
    Long owner = createUser("b");
    var p = newProject(owner, "VSB");
    var d = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("t", "TEXT", null));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(d.id(), om.valueToTree("v")))));
    int before =
        (int)
            historyRepository.findByIssue(issue.id()).stream()
                .filter(h -> "CUSTOM_FIELD_CHANGED".equals(h.eventType()))
                .count();

    service.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(d.id(), om.valueToTree("v")))));

    int after =
        (int)
            historyRepository.findByIssue(issue.id()).stream()
                .filter(h -> "CUSTOM_FIELD_CHANGED".equals(h.eventType()))
                .count();
    assertThat(after).isEqualTo(before);
  }

  @Test
  void null_value_deletes_row_and_records_history() {
    Long owner = createUser("c");
    var p = newProject(owner, "VSC");
    var d = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("t", "TEXT", null));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(d.id(), om.valueToTree("v")))));

    service.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(d.id(), NullNode.getInstance()))));

    assertThat(valueRepo.findValuesByIssue(issue.id())).isEmpty();
    long count =
        historyRepository.findByIssue(issue.id()).stream()
            .filter(h -> "CUSTOM_FIELD_CHANGED".equals(h.eventType()))
            .count();
    assertThat(count).isEqualTo(2); // 추가 + 삭제
  }

  @Test
  void def_from_other_project_throws_400() {
    Long owner = createUser("d");
    var pa = newProject(owner, "VSDA");
    var pb = newProject(owner, "VSDB");
    var foreign =
        defService.create(owner, pb.key(), new CreateIssueFieldDefRequest("t", "TEXT", null));
    issueRepository.insert(pa.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(
            () ->
                service.replace(
                    owner,
                    pa.key(),
                    1,
                    new UpdateIssueFieldsRequest(
                        List.of(new FieldValueInput(foreign.id(), om.valueToTree("v"))))))
        .isInstanceOf(InvalidFieldForProjectException.class);
  }

  @Test
  void select_value_outside_options_throws_400() {
    Long owner = createUser("e");
    var p = newProject(owner, "VSE");
    var opts = om.createArrayNode().add("a").add("b");
    var d = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("s", "SELECT", opts));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(
            () ->
                service.replace(
                    owner,
                    p.key(),
                    1,
                    new UpdateIssueFieldsRequest(
                        List.of(new FieldValueInput(d.id(), om.valueToTree("c"))))))
        .isInstanceOf(InvalidFieldValueException.class);
  }

  @Test
  void text_with_number_throws_400() {
    Long owner = createUser("f");
    var p = newProject(owner, "VSF");
    var d = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("t", "TEXT", null));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(
            () ->
                service.replace(
                    owner,
                    p.key(),
                    1,
                    new UpdateIssueFieldsRequest(
                        List.of(new FieldValueInput(d.id(), om.valueToTree(42))))))
        .isInstanceOf(InvalidFieldValueException.class);
  }

  @Test
  void number_with_string_throws_400() {
    Long owner = createUser("g");
    var p = newProject(owner, "VSG");
    var d = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("n", "NUMBER", null));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    assertThatThrownBy(
            () ->
                service.replace(
                    owner,
                    p.key(),
                    1,
                    new UpdateIssueFieldsRequest(
                        List.of(new FieldValueInput(d.id(), om.valueToTree("x"))))))
        .isInstanceOf(InvalidFieldValueException.class);
  }

  @Test
  void multi_select_subset_ok_outside_throws() {
    Long owner = createUser("h");
    var p = newProject(owner, "VSH");
    var opts = om.createArrayNode().add("a").add("b");
    var d =
        defService.create(
            owner, p.key(), new CreateIssueFieldDefRequest("m", "MULTI_SELECT", opts));
    issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    service.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(
            List.of(new FieldValueInput(d.id(), om.valueToTree(List.of("a"))))));

    assertThatThrownBy(
            () ->
                service.replace(
                    owner,
                    p.key(),
                    1,
                    new UpdateIssueFieldsRequest(
                        List.of(new FieldValueInput(d.id(), om.valueToTree(List.of("a", "c")))))))
        .isInstanceOf(InvalidFieldValueException.class);
  }

  @Test
  void empty_values_is_noop() {
    Long owner = createUser("i");
    var p = newProject(owner, "VSI");
    var d = defService.create(owner, p.key(), new CreateIssueFieldDefRequest("t", "TEXT", null));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    service.replace(
        owner,
        p.key(),
        1,
        new UpdateIssueFieldsRequest(List.of(new FieldValueInput(d.id(), om.valueToTree("v")))));

    service.replace(owner, p.key(), 1, new UpdateIssueFieldsRequest(List.of()));

    // 기존 값 유지 — incoming 이 없으므로 변경/삭제 없음
    assertThat(valueRepo.findValuesByIssue(issue.id())).containsKey(d.id());
  }
}
