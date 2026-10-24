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
import com.workplace.issue.dto.ReorderProjectStatusesRequest;
import com.workplace.issue.dto.UpdateProjectStatusRequest;
import com.workplace.issue.exception.InvalidStatusForProjectException;
import com.workplace.issue.exception.StatusEditNotSupportedException;
import com.workplace.issue.exception.StatusLimitExceededException;
import com.workplace.issue.exception.StatusNameDuplicatedException;
import com.workplace.issue.exception.StatusNotFoundException;
import com.workplace.issue.repository.ProjectStatusRepository;
import com.workplace.label.exception.InvalidColorTokenException;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.PersonalProjectProvisioner;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
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
  @Autowired ProjectStatusRepository repo;

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
    return service.create(caller, key, new CreateProjectStatusRequest(name, category, null, null));
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

    service.create(
        owner, p.key(), new CreateProjectStatusRequest("설계", "IN_PROGRESS", inProgress, null));

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
                    owner,
                    p.key(),
                    new CreateProjectStatusRequest("설계", "IN_PROGRESS", done, null)))
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
                    new CreateProjectStatusRequest("설계", "IN_PROGRESS", otherInProgress, null)))
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
            () -> service.update(owner, p.key(), todo, new UpdateProjectStatusRequest("​", null)))
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
    // 이름 변경도 같은 규칙. 중복은 미리 확인해 409 로 거절하므로 트랜잭션이 깨지지 않아 같은 트랜잭션에서 이어 쓸 수 있다
    Long todo = byName(owner, p.key(), "할 일").id();
    assertThatThrownBy(
            () ->
                service.update(
                    owner, p.key(), todo, new UpdateProjectStatusRequest("REVIEW", null)))
        .isInstanceOf(StatusNameDuplicatedException.class);
    assertThat(byName(owner, p.key(), "할 일").id()).isEqualTo(todo);
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
              () ->
                  service.update(owner, p.key(), todo, new UpdateProjectStatusRequest(code, null)))
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
        service.update(
            owner, p.key(), inProgress.id(), new UpdateProjectStatusRequest("작업 중", null));

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

    var renamed =
        service.update(owner, p.key(), todo.id(), new UpdateProjectStatusRequest("할 일", null));

    assertThat(renamed.name()).isEqualTo("할 일");
  }

  @Test
  void 다른_프로젝트의_상태를_rename하면_404() {
    Long owner = createUser("rx");
    ProjectResponse p = newProject(owner, "PSM");
    ProjectResponse other = newProject(owner, "PSN");
    Long otherTodo = byName(owner, other.key(), "할 일").id();

    assertThatThrownBy(
            () ->
                service.update(
                    owner, p.key(), otherTodo, new UpdateProjectStatusRequest("X", null)))
        .isInstanceOf(StatusNotFoundException.class);
  }

  @Test
  void MEMBER는_update가_403() {
    Long owner = createUser("ow");
    Long member = createUser("mb");
    ProjectResponse p = newProject(owner, "PSO");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    Long todo = byName(owner, p.key(), "할 일").id();

    assertThat(service.list(member, p.key())).hasSize(4);
    assertThatThrownBy(() -> create(member, p.key(), "검토 중", "IN_PROGRESS"))
        .isInstanceOf(ProjectAccessDeniedException.class);
    assertThatThrownBy(
            () -> service.update(member, p.key(), todo, new UpdateProjectStatusRequest("X", null)))
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
            () -> service.update(owner, p.key(), todo, new UpdateProjectStatusRequest("X", null)))
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

    service.create(owner, p.key(), new CreateProjectStatusRequest("A", "TODO", todo, null));
    service.create(owner, p.key(), new CreateProjectStatusRequest("B", "TODO", todo, null));
    create(owner, p.key(), "C", "CANCELED");

    var rows = service.list(owner, p.key());
    assertThat(new HashSet<>(rows.stream().map(ProjectStatusResponse::position).toList()))
        .hasSize(rows.size());
    // 같은 after 로 두 번 넣으면 나중 것이 바로 뒤에 온다
    assertThat(rows.stream().map(ProjectStatusResponse::name).toList())
        .containsExactly("할 일", "B", "A", "진행 중", "완료", "취소", "C");
  }

  // ---- 상태 색(WP-809) ----

  @Test
  void color없이_만들면_범주기본색() {
    Long owner = createUser("cl");
    ProjectResponse p = newProject(owner, "PSR");

    assertThat(create(owner, p.key(), "검토 중", "IN_PROGRESS").color()).isEqualTo("BLUE");
    assertThat(create(owner, p.key(), "보류", "CANCELED").color()).isEqualTo("GRAY");
    // 목록 조회에도 같은 색이 실린다
    assertThat(byName(owner, p.key(), "검토 중").color()).isEqualTo("BLUE");
  }

  @Test
  void color를_주면_그색으로_만든다() {
    Long owner = createUser("cp");
    ProjectResponse p = newProject(owner, "PSS");

    var created =
        service.create(
            owner, p.key(), new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, "PURPLE"));

    assertThat(created.color()).isEqualTo("PURPLE");
    assertThat(byName(owner, p.key(), "검토 중").color()).isEqualTo("PURPLE");
  }

  @Test
  void 모르는_color는_400() {
    Long owner = createUser("cn");
    ProjectResponse p = newProject(owner, "PST");
    Long todo = byName(owner, p.key(), "할 일").id();

    assertThatThrownBy(
            () ->
                service.create(
                    owner,
                    p.key(),
                    new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, "NEON")))
        .isInstanceOf(InvalidColorTokenException.class);
    assertThatThrownBy(
            () ->
                service.update(owner, p.key(), todo, new UpdateProjectStatusRequest(null, "NEON")))
        .isInstanceOf(InvalidColorTokenException.class);
  }

  @Test
  void update_색만_바꾸면_이름은_그대로() {
    Long owner = createUser("uc");
    ProjectResponse p = newProject(owner, "PSU");
    var inProgress = byName(owner, p.key(), "진행 중");

    var updated =
        service.update(
            owner, p.key(), inProgress.id(), new UpdateProjectStatusRequest(null, "RED"));

    assertThat(updated.name()).isEqualTo("진행 중");
    assertThat(updated.color()).isEqualTo("RED");
    assertThat(byName(owner, p.key(), "진행 중").color()).isEqualTo("RED");
  }

  @Test
  void update_이름만_바꾸면_색은_그대로() {
    Long owner = createUser("un");
    ProjectResponse p = newProject(owner, "PSV");
    var done = byName(owner, p.key(), "완료");

    var updated =
        service.update(owner, p.key(), done.id(), new UpdateProjectStatusRequest("끝남", null));

    assertThat(updated.name()).isEqualTo("끝남");
    assertThat(updated.color()).isEqualTo("GREEN");
  }

  @Test
  void update_둘다_없으면_400() {
    Long owner = createUser("ue");
    ProjectResponse p = newProject(owner, "PSW");
    Long todo = byName(owner, p.key(), "할 일").id();

    assertThatThrownBy(
            () -> service.update(owner, p.key(), todo, new UpdateProjectStatusRequest(null, null)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("바꿀 내용을 입력해 주세요");
  }

  // ---- 같은 범주 안 순서 변경(WP-809) ----

  /** 진행 중 범주에 「검토 중」「QA」를 더해 [진행 중, 검토 중, QA] 로 만든다. */
  private ProjectResponse projectWithThreeInProgress(Long owner, String prefix) {
    ProjectResponse p = newProject(owner, prefix);
    create(owner, p.key(), "검토 중", "IN_PROGRESS");
    create(owner, p.key(), "QA", "IN_PROGRESS");
    return p;
  }

  private List<Long> ids(Long caller, String key, String... statusNames) {
    return java.util.Arrays.stream(statusNames).map(n -> byName(caller, key, n).id()).toList();
  }

  private List<ProjectStatusResponse> reorder(Long caller, String key, List<Long> statusIds) {
    return service.reorder(
        caller, key, new ReorderProjectStatusesRequest("IN_PROGRESS", statusIds));
  }

  @Test
  void reorder는_그범주_안에서만_순서를_바꾼다() {
    Long owner = createUser("ro");
    ProjectResponse p = projectWithThreeInProgress(owner, "PRA");

    var result = reorder(owner, p.key(), ids(owner, p.key(), "QA", "진행 중", "검토 중"));

    // 응답은 서버 정렬의 전체 목록
    assertThat(result)
        .extracting(ProjectStatusResponse::name)
        .containsExactly("할 일", "QA", "진행 중", "검토 중", "완료", "취소");
    assertThat(names(owner, p.key())).containsExactly("할 일", "QA", "진행 중", "검토 중", "완료", "취소");
  }

  @Test
  void reorder는_다른범주_position을_바꾸지_않는다() {
    Long owner = createUser("rp");
    ProjectResponse p = projectWithThreeInProgress(owner, "PRB");
    Map<String, Integer> before = positionsOutsideInProgress(owner, p.key());

    reorder(owner, p.key(), ids(owner, p.key(), "QA", "진행 중", "검토 중"));

    assertThat(positionsOutsideInProgress(owner, p.key())).isEqualTo(before);
  }

  private Map<String, Integer> positionsOutsideInProgress(Long caller, String key) {
    return service.list(caller, key).stream()
        .filter(s -> !s.category().equals("IN_PROGRESS"))
        .collect(Collectors.toMap(ProjectStatusResponse::name, ProjectStatusResponse::position));
  }

  @Test
  void reorder후_position은_프로젝트전체_단조증가() {
    Long owner = createUser("rm");
    ProjectResponse p = projectWithThreeInProgress(owner, "PRC");
    create(owner, p.key(), "접수", "TODO");

    reorder(owner, p.key(), ids(owner, p.key(), "검토 중", "QA", "진행 중"));

    var positions =
        service.list(owner, p.key()).stream().map(ProjectStatusResponse::position).toList();
    for (int i = 1; i < positions.size(); i++) {
      assertThat(positions.get(i)).isGreaterThan(positions.get(i - 1));
    }
  }

  @Test
  void reorder후_첫상태가_범주기본이_된다() {
    Long owner = createUser("rd");
    ProjectResponse p = projectWithThreeInProgress(owner, "PRD");

    reorder(owner, p.key(), ids(owner, p.key(), "QA", "진행 중", "검토 중"));

    assertThat(repo.findDefault(p.id(), "IN_PROGRESS").orElseThrow().name()).isEqualTo("QA");
  }

  @Test
  void 다른범주_id가_섞이면_400() {
    Long owner = createUser("rx");
    ProjectResponse p = projectWithThreeInProgress(owner, "PRE");

    assertThatThrownBy(() -> reorder(owner, p.key(), ids(owner, p.key(), "QA", "진행 중", "완료")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("그 범주의 상태 전체를 한 번씩 보내 주세요");
    // 섞인 채 4개를 보내도(집합이 다르므로) 거절
    assertThatThrownBy(
            () -> reorder(owner, p.key(), ids(owner, p.key(), "QA", "진행 중", "검토 중", "완료")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("그 범주의 상태 전체를 한 번씩 보내 주세요");
    assertThat(names(owner, p.key())).containsExactly("할 일", "진행 중", "검토 중", "QA", "완료", "취소");
  }

  @Test
  void 누락이면_400() {
    Long owner = createUser("rl");
    ProjectResponse p = projectWithThreeInProgress(owner, "PRF");

    assertThatThrownBy(() -> reorder(owner, p.key(), ids(owner, p.key(), "QA", "진행 중")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("그 범주의 상태 전체를 한 번씩 보내 주세요");
  }

  @Test
  void 중복이면_400() {
    Long owner = createUser("rq");
    ProjectResponse p = projectWithThreeInProgress(owner, "PRG");

    // 집합으로는 같지만 한 상태가 두 번 — 중복도 거절
    assertThatThrownBy(
            () -> reorder(owner, p.key(), ids(owner, p.key(), "QA", "진행 중", "검토 중", "QA")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("그 범주의 상태 전체를 한 번씩 보내 주세요");
  }

  @Test
  void MEMBER는_403_개인프로젝트는_400() {
    Long owner = createUser("rw");
    Long member = createUser("rv");
    ProjectResponse p = projectWithThreeInProgress(owner, "PRH");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    List<Long> order = ids(owner, p.key(), "QA", "진행 중", "검토 중");

    assertThatThrownBy(() -> reorder(member, p.key(), order))
        .isInstanceOf(ProjectAccessDeniedException.class);

    var personal = personalProjectProvisioner.createPersonal(owner, "개인 작업", null, false);
    List<Long> personalOrder = ids(owner, personal.key(), "진행 중");
    assertThatThrownBy(() -> reorder(owner, personal.key(), personalOrder))
        .isInstanceOf(StatusEditNotSupportedException.class);
  }

  /** 기본 4상태에 「진행 N」 이름으로 n 개를 더한다 — 상한 테스트용. */
  private void fill(Long owner, String key, int n) {
    for (int i = 0; i < n; i++) {
      create(owner, key, "진행 " + i, "IN_PROGRESS");
    }
  }

  @Test
  void 상태가_20개면_추가가_409와_문구() {
    Long owner = createUser("lm");
    ProjectResponse p = newProject(owner, "PLA");
    fill(owner, p.key(), 16); // 기본 4 + 16 = 20

    assertThatThrownBy(() -> create(owner, p.key(), "하나 더", "TODO"))
        .isInstanceOf(StatusLimitExceededException.class)
        .hasMessage("상태는 프로젝트당 20개까지 만들 수 있어요");
    assertThat(service.list(owner, p.key())).hasSize(ProjectStatusService.MAX_STATUSES);
  }

  @Test
  void 상태가_19개면_추가된다() {
    Long owner = createUser("ln");
    ProjectResponse p = newProject(owner, "PLB");
    fill(owner, p.key(), 15); // 기본 4 + 15 = 19

    create(owner, p.key(), "스무 번째", "DONE");

    assertThat(service.list(owner, p.key())).hasSize(20);
  }
}
