package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.issue.exception.SystemTypeImmutableException;
import com.workplace.issue.exception.TypeInUseException;
import com.workplace.issue.exception.TypeNameDuplicatedException;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.label.exception.InvalidColorTokenException;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** IssueTypeService 통합 테스트 — OWNER 권한 가드, 시스템 보호, 사용 중 가드, 중복/유효성. */
@Transactional
class IssueTypeServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueTypeService service;
  @Autowired IssueTypeRepository typeRepository;
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
    // Task 5 ProjectService 통합 이후 — create 가 시스템 4종을 자동 시드.
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  @Test
  void owner_creates_custom_type() {
    Long owner = createUser("a");
    ProjectResponse p = newProject(owner, "TSA");

    var resp = service.create(owner, p.key(), new CreateIssueTypeRequest("디자인", "PURPLE", "Star"));

    assertThat(resp.isSystem()).isFalse();
    assertThat(resp.name()).isEqualTo("디자인");
    assertThat(resp.icon()).isEqualTo("Star");
  }

  @Test
  void member_create_forbidden() {
    Long owner = createUser("b");
    Long member = createUser("b-m");
    ProjectResponse p = newProject(owner, "TSB");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));

    assertThatThrownBy(
            () -> service.create(member, p.key(), new CreateIssueTypeRequest("X", "RED", "Star")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void system_type_patch_throws_409() {
    Long owner = createUser("c");
    ProjectResponse p = newProject(owner, "TSC");
    var taskType = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow();

    assertThatThrownBy(
            () ->
                service.update(
                    owner, p.key(), taskType.id(), new CreateIssueTypeRequest("X", "RED", "Star")))
        .isInstanceOf(SystemTypeImmutableException.class);
  }

  @Test
  void system_type_delete_throws_409() {
    Long owner = createUser("d");
    ProjectResponse p = newProject(owner, "TSD");
    var taskType = typeRepository.findByProjectAndName(p.id(), "TASK").orElseThrow();

    assertThatThrownBy(() -> service.delete(owner, p.key(), taskType.id()))
        .isInstanceOf(SystemTypeImmutableException.class);
  }

  @Test
  void delete_custom_in_use_throws_409() {
    Long owner = createUser("e");
    ProjectResponse p = newProject(owner, "TSE");
    var custom =
        service.create(owner, p.key(), new CreateIssueTypeRequest("디자인", "PURPLE", "Star"));
    // 이슈 한 건을 해당 유형으로 직접 INSERT — Task 6 의 insert 시그니처 변경 전 우회 (DSL 직접).
    dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, p.id())
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, "t")
        .set(ISSUE.PRIORITY, "MID")
        .set(ISSUE.REPORTER_ID, owner)
        .set(ISSUE.TYPE_ID, custom.id())
        .execute();

    assertThatThrownBy(() -> service.delete(owner, p.key(), custom.id()))
        .isInstanceOf(TypeInUseException.class);
  }

  @Test
  void duplicate_name_throws_409() {
    Long owner = createUser("f");
    ProjectResponse p = newProject(owner, "TSF");
    service.create(owner, p.key(), new CreateIssueTypeRequest("디자인", "PURPLE", "Star"));

    assertThatThrownBy(
            () -> service.create(owner, p.key(), new CreateIssueTypeRequest("디자인", "RED", "Bug")))
        .isInstanceOf(TypeNameDuplicatedException.class);
  }

  @Test
  void invalid_icon_throws_400() {
    Long owner = createUser("g");
    ProjectResponse p = newProject(owner, "TSG");

    assertThatThrownBy(
            () -> service.create(owner, p.key(), new CreateIssueTypeRequest("X", "RED", "Heart")))
        .isInstanceOf(com.workplace.issue.exception.InvalidTypeIconException.class);
  }

  @Test
  void invalid_color_throws_400() {
    Long owner = createUser("h");
    ProjectResponse p = newProject(owner, "TSH");

    assertThatThrownBy(
            () ->
                service.create(owner, p.key(), new CreateIssueTypeRequest("X", "MAGENTA", "Star")))
        .isInstanceOf(InvalidColorTokenException.class);
  }
}
