package com.workplace.label.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.exception.InvalidColorTokenException;
import com.workplace.label.exception.LabelNameDuplicatedException;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** LabelService 통합 테스트 — OWNER 가드, 중복/색상 검증. */
@Transactional
class LabelServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired LabelService labelService;
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

  @Test
  void owner_can_create_label() {
    Long owner = createUser("o");
    ProjectResponse p = newProject(owner, "LA");

    var resp = labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));
    assertThat(resp.name()).isEqualTo("버그");
    assertThat(resp.colorToken()).isEqualTo("RED");
  }

  @Test
  void non_owner_member_cannot_create() {
    Long owner = createUser("o2");
    Long member = createUser("m2");
    ProjectResponse p = newProject(owner, "LB");
    memberRepository.insert(p.id(), member, "MEMBER");

    assertThatThrownBy(
            () -> labelService.create(member, p.key(), new CreateLabelRequest("버그", "RED")))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void duplicate_name_in_same_project_throws_409() {
    Long owner = createUser("o3");
    ProjectResponse p = newProject(owner, "LC");
    labelService.create(owner, p.key(), new CreateLabelRequest("버그", "RED"));

    assertThatThrownBy(
            () -> labelService.create(owner, p.key(), new CreateLabelRequest("버그", "BLUE")))
        .isInstanceOf(LabelNameDuplicatedException.class);
  }

  @Test
  void invalid_color_token_throws_400() {
    Long owner = createUser("o4");
    ProjectResponse p = newProject(owner, "LD");

    assertThatThrownBy(
            () -> labelService.create(owner, p.key(), new CreateLabelRequest("버그", "MAGENTA")))
        .isInstanceOf(InvalidColorTokenException.class);
  }

  @Test
  void same_name_across_different_projects_allowed() {
    Long owner = createUser("o5");
    ProjectResponse p1 = newProject(owner, "LE");
    ProjectResponse p2 = newProject(owner, "LF");

    labelService.create(owner, p1.key(), new CreateLabelRequest("버그", "RED"));
    var r = labelService.create(owner, p2.key(), new CreateLabelRequest("버그", "BLUE"));
    assertThat(r.id()).isNotNull();
  }
}
