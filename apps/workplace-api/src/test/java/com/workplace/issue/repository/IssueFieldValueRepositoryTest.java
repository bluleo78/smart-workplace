package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
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

/** IssueFieldValueRepository 통합 테스트 — upsert/diff 조회/batch fetch/cascade. */
@Transactional
class IssueFieldValueRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueFieldDefRepository defRepo;
  @Autowired IssueFieldValueRepository valueRepo;
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
  void upsert_then_find_values_round_trip() {
    Long owner = createUser("a");
    var p = newProject(owner, "FVA");
    var def = defRepo.insert(p.id(), "메모", "TEXT", null, 0);
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    valueRepo.upsert(issue.id(), def.id(), om.valueToTree("hello"));
    var map = valueRepo.findValuesByIssue(issue.id());

    assertThat(map).containsKey(def.id());
    assertThat(map.get(def.id()).asText()).isEqualTo("hello");
  }

  @Test
  void upsert_overrides_existing_value() {
    Long owner = createUser("b");
    var p = newProject(owner, "FVB");
    var def = defRepo.insert(p.id(), "n", "NUMBER", null, 0);
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    valueRepo.upsert(issue.id(), def.id(), om.valueToTree(1));

    valueRepo.upsert(issue.id(), def.id(), om.valueToTree(2));

    assertThat(valueRepo.findValuesByIssue(issue.id()).get(def.id()).asInt()).isEqualTo(2);
  }

  @Test
  void delete_removes_value() {
    Long owner = createUser("c");
    var p = newProject(owner, "FVC");
    var def = defRepo.insert(p.id(), "x", "TEXT", null, 0);
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    valueRepo.upsert(issue.id(), def.id(), om.valueToTree("x"));

    valueRepo.delete(issue.id(), def.id());

    assertThat(valueRepo.findValuesByIssue(issue.id())).isEmpty();
  }

  @Test
  void find_by_issue_ids_batch_no_n_plus_one() {
    Long owner = createUser("d");
    var p = newProject(owner, "FVD");
    var def1 = defRepo.insert(p.id(), "a", "TEXT", null, 0);
    var def2 = defRepo.insert(p.id(), "b", "NUMBER", null, 1);
    var issue1 = issueRepository.insert(p.id(), 1, "t1", null, "MID", null, owner);
    var issue2 = issueRepository.insert(p.id(), 2, "t2", null, "MID", null, owner);
    valueRepo.upsert(issue1.id(), def1.id(), om.valueToTree("v1"));
    valueRepo.upsert(issue1.id(), def2.id(), om.valueToTree(10));
    valueRepo.upsert(issue2.id(), def1.id(), om.valueToTree("v2"));

    var map = valueRepo.findByIssueIds(List.of(issue1.id(), issue2.id()));

    assertThat(map.get(issue1.id())).hasSize(2);
    assertThat(map.get(issue2.id())).hasSize(1);
    assertThat(map.get(issue1.id()).get(0).name()).isEqualTo("a");
    assertThat(map.get(issue1.id()).get(0).type()).isEqualTo("TEXT");
  }

  @Test
  void count_by_def() {
    Long owner = createUser("e");
    var p = newProject(owner, "FVE");
    var def = defRepo.insert(p.id(), "x", "TEXT", null, 0);
    var i1 = issueRepository.insert(p.id(), 1, "t1", null, "MID", null, owner);
    var i2 = issueRepository.insert(p.id(), 2, "t2", null, "MID", null, owner);
    valueRepo.upsert(i1.id(), def.id(), om.valueToTree("a"));
    valueRepo.upsert(i2.id(), def.id(), om.valueToTree("b"));

    assertThat(valueRepo.countByDef(def.id())).isEqualTo(2);
  }
}
