package com.workplace.view.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.view.dto.PinnedSavedViewResponse;
import com.workplace.view.dto.SaveViewRequest;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** MePinnedViewService 통합 테스트 — 사용자의 프로젝트 교차 고정뷰 조회. */
@Transactional
class MePinnedViewServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MePinnedViewService service;
  @Autowired SavedViewService savedViewService;
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
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  private SaveViewRequest req(String name, String query, String visibility) {
    return new SaveViewRequest(name, query, visibility);
  }

  @Test
  void list_returnsPinnedAcrossProjects_withProjectKey() {
    Long owner = createUser("pinowner");
    var p1 = newProject(owner, "pin1");
    var p2 = newProject(owner, "pin2");
    var v1 = savedViewService.create(owner, p1.key(), req("높은우선", "priority=HIGH", "PRIVATE"));
    var v2 = savedViewService.create(owner, p2.key(), req("내것", "assignee=me", "PRIVATE"));
    savedViewService.togglePin(owner, p1.key(), v1.id(), true);
    savedViewService.togglePin(owner, p2.key(), v2.id(), true);

    var pinned = service.list(owner);

    assertThat(pinned).extracting(PinnedSavedViewResponse::projectKey).contains(p1.key(), p2.key());
    assertThat(pinned)
        .allSatisfy(
            p -> {
              assertThat(p.query()).isNotBlank();
              assertThat(p.name()).isNotBlank();
              assertThat(p.projectName()).isNotBlank();
            });
  }
}
