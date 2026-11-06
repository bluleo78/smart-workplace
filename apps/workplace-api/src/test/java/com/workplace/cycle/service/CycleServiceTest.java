package com.workplace.cycle.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.exception.CycleNameDuplicatedException;
import com.workplace.cycle.exception.InvalidCycleDateRangeException;
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

  /** 이름만 바꾸는 갱신 요청(날짜·상태는 그대로). */
  private static CreateCycleRequest renameReq(String name) {
    return new CreateCycleRequest(name, null, null, null, null);
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

  /** WP-1393: 대소문자만 다른 이름도 같은 이름이다 — 라벨·마일스톤(WP-911)과 같이 409. */
  @Test
  void case_only_different_name_in_same_project_throws_409() {
    Long owner = createUser("o3c");
    ProjectResponse p = newProject(owner, "CK");
    cycleService.create(owner, p.key(), req("R65-Cy"));

    assertThatThrownBy(() -> cycleService.create(owner, p.key(), req("r65-cy")))
        .isInstanceOf(CycleNameDuplicatedException.class);
  }

  /** WP-1393: 이름 변경으로 다른 사이클과 대소문자만 같게 만들어도 409. */
  @Test
  void rename_to_case_only_different_existing_name_throws_409() {
    Long owner = createUser("o3d");
    ProjectResponse p = newProject(owner, "CL");
    cycleService.create(owner, p.key(), req("Sprint A"));
    var b = cycleService.create(owner, p.key(), req("Sprint B"));

    assertThatThrownBy(() -> cycleService.update(owner, p.key(), b.id(), renameReq("sprint a")))
        .isInstanceOf(CycleNameDuplicatedException.class);
  }

  /**
   * WP-1393: 자기 이름의 대소문자만 바꾸는 변경은 허용(자기 행과는 충돌하지 않는다). 제약 위반 뒤에는 테스트 트랜잭션이 중단되므로 위 409 테스트와 나눈다.
   */
  @Test
  void rename_own_name_case_only_is_allowed() {
    Long owner = createUser("o3e");
    ProjectResponse p = newProject(owner, "CM");
    var b = cycleService.create(owner, p.key(), req("Sprint B"));

    var renamed = cycleService.update(owner, p.key(), b.id(), renameReq("SPRINT B"));
    assertThat(renamed.name()).isEqualTo("SPRINT B");
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
  void end_date_before_start_date_throws_400_on_create() {
    Long owner = createUser("o8");
    ProjectResponse p = newProject(owner, "CI");

    assertThatThrownBy(
            () ->
                cycleService.create(
                    owner,
                    p.key(),
                    new CreateCycleRequest(
                        "역전", null, LocalDate.of(2026, 9, 10), LocalDate.of(2026, 9, 1), null)))
        .isInstanceOf(InvalidCycleDateRangeException.class);
  }

  @Test
  void end_date_before_start_date_throws_400_on_update() {
    Long owner = createUser("o9");
    ProjectResponse p = newProject(owner, "CJ");
    var c = cycleService.create(owner, p.key(), req("스프린트"));

    assertThatThrownBy(
            () ->
                cycleService.update(
                    owner,
                    p.key(),
                    c.id(),
                    new CreateCycleRequest(
                        "스프린트", null, LocalDate.of(2026, 9, 10), LocalDate.of(2026, 9, 1), null)))
        .isInstanceOf(InvalidCycleDateRangeException.class);
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
