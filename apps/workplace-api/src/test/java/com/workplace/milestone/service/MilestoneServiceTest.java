package com.workplace.milestone.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.MILESTONE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.milestone.exception.MilestoneNameDuplicatedException;
import com.workplace.milestone.exception.MilestoneNotFoundException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** MilestoneService 통합 테스트 — 멤버 가드, 이름 중복/프로젝트 격리, 이슈 milestone_id ON DELETE SET NULL, RLS 격리. */
@Transactional
class MilestoneServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MilestoneService milestoneService;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;

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

  private CreateMilestoneRequest req(String name) {
    return new CreateMilestoneRequest(name, LocalDate.of(2026, 8, 1), "설명");
  }

  @Test
  void member_can_create_and_list_milestone() {
    Long owner = createUser("o");
    ProjectResponse p = newProject(owner, "MA");

    var created = milestoneService.create(owner, p.key(), req("베타 출시"));
    assertThat(created.name()).isEqualTo("베타 출시");
    assertThat(created.projectId()).isEqualTo(p.id());
    assertThat(created.dueDate()).isEqualTo(LocalDate.of(2026, 8, 1));
    assertThat(created.description()).isEqualTo("설명");

    var list = milestoneService.list(owner, p.key());
    assertThat(list).hasSize(1);
    assertThat(list.get(0).id()).isEqualTo(created.id());
    assertThat(list.get(0).name()).isEqualTo("베타 출시");
  }

  @Test
  void duplicate_name_in_project_throws() {
    Long owner = createUser("o2");
    ProjectResponse p = newProject(owner, "MB");
    milestoneService.create(owner, p.key(), req("스프린트 1"));

    assertThatThrownBy(() -> milestoneService.create(owner, p.key(), req("스프린트 1")))
        .isInstanceOf(MilestoneNameDuplicatedException.class);
  }

  @Test
  void non_member_cannot_create() {
    Long owner = createUser("o3");
    Long stranger = createUser("s3");
    ProjectResponse p = newProject(owner, "MC");

    assertThatThrownBy(() -> milestoneService.create(stranger, p.key(), req("스프린트")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void update_changes_name_and_due_date() {
    Long owner = createUser("o4");
    ProjectResponse p = newProject(owner, "MD");
    var created = milestoneService.create(owner, p.key(), req("스프린트"));

    var updated =
        milestoneService.update(
            owner,
            p.key(),
            created.id(),
            new CreateMilestoneRequest("스프린트 A", LocalDate.of(2026, 9, 1), "새 설명"));
    assertThat(updated.name()).isEqualTo("스프린트 A");
    assertThat(updated.dueDate()).isEqualTo(LocalDate.of(2026, 9, 1));
    assertThat(updated.description()).isEqualTo("새 설명");
  }

  @Test
  void milestone_of_other_project_is_not_found() {
    Long owner = createUser("o5");
    ProjectResponse pA = newProject(owner, "ME");
    ProjectResponse pB = newProject(owner, "MF");
    var created = milestoneService.create(owner, pA.key(), req("스프린트"));

    assertThatThrownBy(() -> milestoneService.update(owner, pB.key(), created.id(), req("스프린트 X")))
        .isInstanceOf(MilestoneNotFoundException.class);
  }

  @Test
  void delete_clears_issue_milestone_id() {
    Long owner = createUser("o6");
    ProjectResponse p = newProject(owner, "MG");
    var created = milestoneService.create(owner, p.key(), req("스프린트"));

    // 프로젝트 생성 시 시드된 TASK 시스템 유형 사용
    Long typeId =
        dsl.select(ISSUE_TYPE_DEF.ID)
            .from(ISSUE_TYPE_DEF)
            .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(p.id()))
            .and(ISSUE_TYPE_DEF.NAME.eq("TASK"))
            .fetchOne(ISSUE_TYPE_DEF.ID);

    Long issueId =
        dsl.insertInto(ISSUE)
            .set(ISSUE.PROJECT_ID, p.id())
            .set(ISSUE.NUMBER, 1)
            .set(ISSUE.TITLE, "milestone-linked-issue")
            .set(ISSUE.REPORTER_ID, owner)
            .set(ISSUE.TYPE_ID, typeId)
            .set(ISSUE.MILESTONE_ID, created.id())
            .returning(ISSUE.ID)
            .fetchOne()
            .getId();

    milestoneService.delete(owner, p.key(), created.id());

    Long milestoneIdAfter =
        dsl.select(ISSUE.MILESTONE_ID)
            .from(ISSUE)
            .where(ISSUE.ID.eq(issueId))
            .fetchOne(ISSUE.MILESTONE_ID);
    assertThat(milestoneIdAfter).isNull();
    assertThat(milestoneService.list(owner, p.key())).isEmpty();
  }

  @Test
  void rls_isolates_other_tenant() {
    Long owner = createUser("o7");
    ProjectResponse p = newProject(owner, "MH");
    milestoneService.create(owner, p.key(), req("우리 마일스톤"));

    // 신규 phantom 테넌트(tid2) 생성 후 GUC 전환 — 같은 트랜잭션 내 FK 대상으로 사용 가능(미커밋)
    String suffix = String.valueOf(System.nanoTime() % 1_000_000);
    Long tid2 =
        dsl.insertInto(TENANT)
            .set(TENANT.SLUG, "rls-milestone-" + suffix)
            .set(TENANT.NAME, "phantom")
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();

    setGuc(tid2);
    Long phantomOwnerId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "rls-milestone-owner-" + suffix)
            .set(USER.NAME, "phantom-owner")
            .set(USER.EMAIL, "rls-milestone-owner-" + suffix + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long phantomProjectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "RLM" + (System.nanoTime() % 100000))
            .set(PROJECT.NAME, "phantom project")
            .set(PROJECT.OWNER_ID, phantomOwnerId)
            .set(PROJECT.TENANT_ID, tid2)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MILESTONE)
        .set(MILESTONE.PROJECT_ID, phantomProjectId)
        .set(MILESTONE.NAME, "phantom milestone")
        .set(MILESTONE.DUE_DATE, LocalDate.of(2026, 12, 1))
        .execute();

    // tenant#1 GUC 로 복귀 → phantom 마일스톤은 이 프로젝트 목록에 없음(RLS 격리)
    setGuc(1L);
    var list = milestoneService.list(owner, p.key());
    assertThat(list).extracting("name").doesNotContain("phantom milestone");
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
