package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_FIELD_VALUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.IssueRow;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.transaction.annotation.Transactional;

/** IssueFieldDefRepository 통합 테스트 — TEXT/SELECT 생성, 조회/batch, update, delete cascade. */
@Transactional
class IssueFieldDefRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueFieldDefRepository defRepo;
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
  void insert_text_field_no_options() {
    Long owner = createUser("a");
    var p = newProject(owner, "FDA");

    var row = defRepo.insert(p.id(), "메모", "TEXT", null, 0);

    assertThat(row.id()).isNotNull();
    assertThat(row.name()).isEqualTo("메모");
    assertThat(row.type()).isEqualTo("TEXT");
    assertThat(row.options()).isNull();
  }

  @Test
  void insert_select_with_options_round_trip() {
    Long owner = createUser("b");
    var p = newProject(owner, "FDB");
    var opts = om.createArrayNode().add("low").add("high");

    var row = defRepo.insert(p.id(), "우선도", "SELECT", opts, 1);

    var fetched = defRepo.findById(row.id()).orElseThrow();
    assertThat(fetched.options().isArray()).isTrue();
    assertThat(fetched.options().get(0).asText()).isEqualTo("low");
    assertThat(fetched.options().get(1).asText()).isEqualTo("high");
  }

  @Test
  void find_by_project_orders_by_position() {
    Long owner = createUser("c");
    var p = newProject(owner, "FDC");
    defRepo.insert(p.id(), "b-필드", "TEXT", null, 10);
    defRepo.insert(p.id(), "a-필드", "TEXT", null, 5);

    var list = defRepo.findByProject(p.id());

    assertThat(list).hasSize(2);
    assertThat(list.get(0).name()).isEqualTo("a-필드");
  }

  @Test
  void find_by_ids_returns_map() {
    Long owner = createUser("d");
    var p = newProject(owner, "FDD");
    var r1 = defRepo.insert(p.id(), "x", "TEXT", null, 0);
    var r2 = defRepo.insert(p.id(), "y", "NUMBER", null, 1);

    var map = defRepo.findByIds(List.of(r1.id(), r2.id()));

    assertThat(map).containsOnlyKeys(r1.id(), r2.id());
  }

  @Test
  void update_changes_name_and_options() {
    Long owner = createUser("e");
    var p = newProject(owner, "FDE");
    var opts = om.createArrayNode().add("a");
    var row = defRepo.insert(p.id(), "원본", "SELECT", opts, 0);

    var opts2 = om.createArrayNode().add("a").add("b");
    defRepo.update(row.id(), "수정", opts2);

    var fetched = defRepo.findById(row.id()).orElseThrow();
    assertThat(fetched.name()).isEqualTo("수정");
    assertThat(fetched.options().size()).isEqualTo(2);
  }

  @Test
  void duplicate_name_throws_duplicate_key() {
    Long owner = createUser("f");
    var p = newProject(owner, "FDF");
    defRepo.insert(p.id(), "공통", "TEXT", null, 0);

    assertThatThrownBy(() -> defRepo.insert(p.id(), "공통", "NUMBER", null, 1))
        .isInstanceOf(DuplicateKeyException.class);
  }

  @Test
  void delete_cascades_field_values() {
    Long owner = createUser("g");
    var p = newProject(owner, "FDG");
    var def = defRepo.insert(p.id(), "x", "TEXT", null, 0);
    IssueRow issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);
    dsl.insertInto(ISSUE_FIELD_VALUE)
        .set(ISSUE_FIELD_VALUE.ISSUE_ID, issue.id())
        .set(ISSUE_FIELD_VALUE.FIELD_DEF_ID, def.id())
        .set(ISSUE_FIELD_VALUE.VALUE, JSONB.valueOf("\"v\""))
        .execute();

    defRepo.delete(def.id());

    int remaining =
        dsl.fetchCount(
            dsl.selectOne()
                .from(ISSUE_FIELD_VALUE)
                .where(ISSUE_FIELD_VALUE.FIELD_DEF_ID.eq(def.id())));
    assertThat(remaining).isZero();
    // 프로젝트 row 는 그대로 (cascade 가 정의 → 값 한 방향)
    assertThat(dsl.fetchCount(dsl.selectOne().from(PROJECT).where(PROJECT.ID.eq(p.id()))))
        .isEqualTo(1);
  }
}
