package com.workplace.cycle.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.exception.CycleNameDuplicatedException;
import com.workplace.cycle.exception.InvalidCycleStatusException;
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

/** CycleService 통합 테스트 — OWNER 가드, 중복/상태 검증, 프로젝트 격리. */
@Transactional
class CycleServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CycleService cycleService;
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

  private CreateCycleRequest req(String name) {
    return new CreateCycleRequest(
        name, null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 14), null);
  }

  @Test
  void owner_can_create_cycle_defaults_to_planned() {
    Long owner = createUser("o");
    ProjectResponse p = newProject(owner, "CA");

    var resp = cycleService.create(owner, p.key(), req("스프린트 1"));
    assertThat(resp.name()).isEqualTo("스프린트 1");
    assertThat(resp.status()).isEqualTo("PLANNED");
  }

  @Test
  void non_owner_member_cannot_create() {
    Long owner = createUser("o2");
    Long member = createUser("m2");
    ProjectResponse p = newProject(owner, "CB");
    memberRepository.insert(p.id(), member, "MEMBER");

    assertThatThrownBy(() -> cycleService.create(member, p.key(), req("스프린트")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void duplicate_name_in_same_project_throws_409() {
    Long owner = createUser("o3");
    ProjectResponse p = newProject(owner, "CC");
    cycleService.create(owner, p.key(), req("스프린트"));

    assertThatThrownBy(() -> cycleService.create(owner, p.key(), req("스프린트")))
        .isInstanceOf(CycleNameDuplicatedException.class);
  }

  @Test
  void invalid_status_throws_400() {
    Long owner = createUser("o4");
    ProjectResponse p = newProject(owner, "CD");

    assertThatThrownBy(
            () ->
                cycleService.create(
                    owner, p.key(), new CreateCycleRequest("S", null, null, null, "RUNNING")))
        .isInstanceOf(InvalidCycleStatusException.class);
  }

  @Test
  void same_name_across_different_projects_allowed() {
    Long owner = createUser("o5");
    ProjectResponse p1 = newProject(owner, "CE");
    ProjectResponse p2 = newProject(owner, "CF");

    cycleService.create(owner, p1.key(), req("스프린트"));
    var r = cycleService.create(owner, p2.key(), req("스프린트"));
    assertThat(r.id()).isNotNull();
  }

  @Test
  void multiple_active_cycles_allowed_in_same_project() {
    Long owner = createUser("o6");
    ProjectResponse p = newProject(owner, "CG");
    var a =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("S1", null, null, null, "ACTIVE"));
    var b =
        cycleService.create(
            owner, p.key(), new CreateCycleRequest("S2", null, null, null, "ACTIVE"));
    assertThat(a.status()).isEqualTo("ACTIVE");
    assertThat(b.status()).isEqualTo("ACTIVE");
  }

  @Test
  void update_and_delete() {
    Long owner = createUser("o7");
    ProjectResponse p = newProject(owner, "CH");
    var c = cycleService.create(owner, p.key(), req("스프린트"));

    var updated =
        cycleService.update(
            owner, p.key(), c.id(), new CreateCycleRequest("스프린트 A", "목표", null, null, "ACTIVE"));
    assertThat(updated.name()).isEqualTo("스프린트 A");
    assertThat(updated.status()).isEqualTo("ACTIVE");

    cycleService.delete(owner, p.key(), c.id());
    assertThat(cycleService.list(owner, p.key())).isEmpty();
  }
}
