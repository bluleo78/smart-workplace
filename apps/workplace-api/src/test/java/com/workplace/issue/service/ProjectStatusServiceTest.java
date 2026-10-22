package com.workplace.issue.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.issue.dto.RenameProjectStatusRequest;
import com.workplace.issue.exception.InvalidStatusForProjectException;
import com.workplace.issue.exception.StatusEditNotSupportedException;
import com.workplace.issue.exception.StatusNameDuplicatedException;
import com.workplace.issue.exception.StatusNotFoundException;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.PersonalProjectProvisioner;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** ProjectStatusService 통합 테스트(WP-807) — 범주·position 순서, 삽입 위치, 이름 정규화·중복·길이, 권한·개인 프로젝트 차단. */
@Transactional
class ProjectStatusServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectStatusService service;
  @Autowired ProjectService projectService;
  @Autowired PersonalProjectProvisioner personalProjectProvisioner;

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
    // 테넌트#1 ACTIVE 멤버십 — addMember 대상의 테넌트 소속 검증(MembershipGuard)에 필요.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  private ProjectResponse newProject(Long ownerId, String prefix, String type) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x", type));
  }

  private ProjectResponse newProject(Long ownerId, String prefix) {
    return newProject(ownerId, prefix, "TEAM");
  }

  /** 이름으로 상태 하나를 찾는다. */
  private ProjectStatusResponse byName(Long caller, String key, String name) {
    return service.list(caller, key).stream()
        .filter(s -> s.name().equals(name))
        .findFirst()
        .orElseThrow();
  }

  private List<String> names(Long caller, String key) {
    return service.list(caller, key).stream().map(ProjectStatusResponse::name).toList();
  }

  private ProjectStatusResponse create(Long caller, String key, String name, String category) {
    return service.create(caller, key, new CreateProjectStatusRequest(name, category, null));
  }

  @Test
  void list는_범주순_position순으로_돌려준다() {
    Long owner = createUser("ls");
    ProjectResponse p = newProject(owner, "PSA");

    assertThat(service.list(owner, p.key()))
        .extracting("name", "category", "position")
        .containsExactly(
            tuple("할 일", "TODO", 0),
            tuple("진행 중", "IN_PROGRESS", 1),
            tuple("완료", "DONE", 2),
            tuple("취소", "CANCELED", 3));
  }

  @Test
  void afterStatusId없이_만들면_범주_맨뒤에_들어간다() {
    Long owner = createUser("ap");
    ProjectResponse p = newProject(owner, "PSB");

    var created = create(owner, p.key(), "검토 중", "IN_PROGRESS");

    assertThat(created.category()).isEqualTo("IN_PROGRESS");
    assertThat(names(owner, p.key())).containsExactly("할 일", "진행 중", "검토 중", "완료", "취소");
    // position 은 프로젝트 전체에서 범주 순서와 맞는 단조 증가값
    assertThat(service.list(owner, p.key()))
        .extracting(ProjectStatusResponse::position)
        .isSorted()
        .doesNotHaveDuplicates();
  }

  @Test
  void afterStatusId를_주면_그_바로_뒤에_들어간다() {
    Long owner = createUser("af");
    ProjectResponse p = newProject(owner, "PSC");
    create(owner, p.key(), "검토 중", "IN_PROGRESS");
    Long inProgress = byName(owner, p.key(), "진행 중").id();

    service.create(owner, p.key(), new CreateProjectStatusRequest("설계", "IN_PROGRESS", inProgress));

    assertThat(names(owner, p.key())).containsExactly("할 일", "진행 중", "설계", "검토 중", "완료", "취소");
    assertThat(service.list(owner, p.key()))
        .extracting(ProjectStatusResponse::position)
        .isSorted()
        .doesNotHaveDuplicates();
  }

  @Test
  void afterStatusId가_다른_범주면_400() {
    Long owner = createUser("ac");
    ProjectResponse p = newProject(owner, "PSD");
    Long done = byName(owner, p.key(), "완료").id();

    assertThatThrownBy(
            () ->
                service.create(
                    owner, p.key(), new CreateProjectStatusRequest("설계", "IN_PROGRESS", done)))
        .isInstanceOf(InvalidStatusForProjectException.class)
        .hasMessage("이 프로젝트의 상태가 아닙니다");
  }

  @Test
  void afterStatusId가_다른_프로젝트면_404() {
    Long owner = createUser("ao");
    ProjectResponse p = newProject(owner, "PSE");
    ProjectResponse other = newProject(owner, "PSF");
    Long otherInProgress = byName(owner, other.key(), "진행 중").id();

    assertThatThrownBy(
            () ->
                service.create(
                    owner,
                    p.key(),
                    new CreateProjectStatusRequest("설계", "IN_PROGRESS", otherInProgress)))
        .isInstanceOf(StatusNotFoundException.class)
        .hasMessage("상태를 찾을 수 없습니다");
  }

  @Test
  void 이름을_다듬어_저장한다() {
    Long owner = createUser("nm");
    ProjectResponse p = newProject(owner, "PSG");

    var created = create(owner, p.key(), "  검토\n중 ", "IN_PROGRESS");

    assertThat(created.name()).isEqualTo("검토 중");
  }

  @Test
  void 보이지않는_글자만_있으면_거절한다() {
    Long owner = createUser("iv");
    ProjectResponse p = newProject(owner, "PSH");

    assertThatThrownBy(() -> create(owner, p.key(), "​ㅤ", "TODO"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("상태 이름을 입력해 주세요");
    Long todo = byName(owner, p.key(), "할 일").id();
    assertThatThrownBy(
            () -> service.rename(owner, p.key(), todo, new RenameProjectStatusRequest("​")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("상태 이름을 입력해 주세요");
  }

  @Test
  void 대소문자_공백만_다른_중복이름은_409() {
    Long owner = createUser("dp");
    ProjectResponse p = newProject(owner, "PSI");
    create(owner, p.key(), "Review", "IN_PROGRESS");

    assertThatThrownBy(() -> create(owner, p.key(), " review ", "DONE"))
        .isInstanceOf(StatusNameDuplicatedException.class)
        .hasMessage("이미 존재하는 상태 이름입니다: review");
    Long todo = byName(owner, p.key(), "할 일").id();
    assertThatThrownBy(
            () -> service.rename(owner, p.key(), todo, new RenameProjectStatusRequest("REVIEW")))
        .isInstanceOf(StatusNameDuplicatedException.class);
  }

  @Test
  void _31자_이름은_거절한다() {
    Long owner = createUser("ln");
    ProjectResponse p = newProject(owner, "PSJ");

    assertThatThrownBy(() -> create(owner, p.key(), "가".repeat(31), "TODO"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("상태 이름은 30자 이하로 입력해 주세요");
    assertThat(create(owner, p.key(), "가".repeat(30), "TODO").name()).hasSize(30);
  }

  /** 범주 코드와 같은 이름은 이력에서 범주 라벨로 잘못 읽히므로 만들기·이름 변경 모두 거절한다(대소문자·앞뒤 공백 무시). */
  @Test
  void 범주코드와_같은_이름은_생성_이름변경_모두_400() {
    Long owner = createUser("cc");
    ProjectResponse p = newProject(owner, "PSC");
    Long todo = byName(owner, p.key(), "할 일").id();
    String msg = "범주 코드(TODO·IN_PROGRESS·DONE·CANCELED)는 상태 이름으로 쓸 수 없습니다";

    for (String code : List.of("TODO", " done ", "In_Progress", "canceled")) {
      assertThatThrownBy(() -> create(owner, p.key(), code, "IN_PROGRESS"))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage(msg);
      assertThatThrownBy(
              () -> service.rename(owner, p.key(), todo, new RenameProjectStatusRequest(code)))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage(msg);
    }
    // 코드를 품은 다른 이름은 막지 않는다
    assertThat(create(owner, p.key(), "TODO 검토", "TODO").name()).isEqualTo("TODO 검토");
  }

  @Test
  void 기본상태도_이름을_바꿀수있고_범주는_그대로다() {
    Long owner = createUser("rn");
    ProjectResponse p = newProject(owner, "PSK");
    var inProgress = byName(owner, p.key(), "진행 중");

    var renamed =
        service.rename(owner, p.key(), inProgress.id(), new RenameProjectStatusRequest("작업 중"));

    assertThat(renamed.id()).isEqualTo(inProgress.id());
    assertThat(renamed.name()).isEqualTo("작업 중");
    assertThat(renamed.category()).isEqualTo("IN_PROGRESS");
    assertThat(renamed.position()).isEqualTo(inProgress.position());
  }

  @Test
  void 자기이름_그대로_rename은_성공한다() {
    Long owner = createUser("sm");
    ProjectResponse p = newProject(owner, "PSL");
    var todo = byName(owner, p.key(), "할 일");

    var renamed = service.rename(owner, p.key(), todo.id(), new RenameProjectStatusRequest("할 일"));

    assertThat(renamed.name()).isEqualTo("할 일");
  }

  @Test
  void 다른_프로젝트의_상태를_rename하면_404() {
    Long owner = createUser("rx");
    ProjectResponse p = newProject(owner, "PSM");
    ProjectResponse other = newProject(owner, "PSN");
    Long otherTodo = byName(owner, other.key(), "할 일").id();

    assertThatThrownBy(
            () -> service.rename(owner, p.key(), otherTodo, new RenameProjectStatusRequest("X")))
        .isInstanceOf(StatusNotFoundException.class);
  }

  @Test
  void MEMBER는_생성_이름변경이_403() {
    Long owner = createUser("ow");
    Long member = createUser("mb");
    ProjectResponse p = newProject(owner, "PSO");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    Long todo = byName(owner, p.key(), "할 일").id();

    assertThat(service.list(member, p.key())).hasSize(4);
    assertThatThrownBy(() -> create(member, p.key(), "검토 중", "IN_PROGRESS"))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(
            () -> service.rename(member, p.key(), todo, new RenameProjectStatusRequest("X")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void 개인프로젝트는_OWNER라도_편집이_400() {
    Long owner = createUser("ps");
    var p = personalProjectProvisioner.createPersonal(owner, "개인 작업", null, false);
    Long todo = byName(owner, p.key(), "할 일").id();

    assertThat(service.list(owner, p.key())).hasSize(4);
    assertThatThrownBy(() -> create(owner, p.key(), "검토 중", "IN_PROGRESS"))
        .isInstanceOf(StatusEditNotSupportedException.class)
        .hasMessage("개인 프로젝트는 상태를 편집할 수 없습니다");
    assertThatThrownBy(
            () -> service.rename(owner, p.key(), todo, new RenameProjectStatusRequest("X")))
        .isInstanceOf(StatusEditNotSupportedException.class);
  }

  @Test
  void OPEN프로젝트_OWNER는_생성할수있다() {
    Long owner = createUser("op");
    ProjectResponse p = newProject(owner, "PSP", "OPEN");

    var created = create(owner, p.key(), "접수", "TODO");

    assertThat(created.name()).isEqualTo("접수");
    assertThat(names(owner, p.key())).containsExactly("할 일", "접수", "진행 중", "완료", "취소");
  }

  @Test
  void 같은_after로_연달아_추가해도_position이_겹치지_않는다() {
    Long owner = createUser("sq");
    ProjectResponse p = newProject(owner, "PSQ");
    Long todo = byName(owner, p.key(), "할 일").id();

    service.create(owner, p.key(), new CreateProjectStatusRequest("A", "TODO", todo));
    service.create(owner, p.key(), new CreateProjectStatusRequest("B", "TODO", todo));
    create(owner, p.key(), "C", "CANCELED");

    var rows = service.list(owner, p.key());
    assertThat(new HashSet<>(rows.stream().map(ProjectStatusResponse::position).toList()))
        .hasSize(rows.size());
    // 같은 after 로 두 번 넣으면 나중 것이 바로 뒤에 온다
    assertThat(rows.stream().map(ProjectStatusResponse::name).toList())
        .containsExactly("할 일", "B", "A", "진행 중", "완료", "취소", "C");
  }
}
