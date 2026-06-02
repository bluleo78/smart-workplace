package com.workplace.view.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.repository.ProjectMemberRepository;
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

  /** 다른 사용자의 고정뷰는 내 목록에 노출되지 않는다 (OWNER_ID 격리). */
  @Test
  void list_excludesOtherUsersPinnedViews() {
    Long ownerA = createUser("pinaA");
    Long ownerB = createUser("pinaB");
    var pB = newProject(ownerB, "pina");
    var vB = savedViewService.create(ownerB, pB.key(), req("B고정", "priority=HIGH", "PRIVATE"));
    savedViewService.togglePin(ownerB, pB.key(), vB.id(), true);

    var pinnedA = service.list(ownerA);

    assertThat(pinnedA).extracting(PinnedSavedViewResponse::id).doesNotContain(vB.id());
  }

  /** 고정되지 않은 뷰는 제외된다 — 고정한 뷰만 반환. */
  @Test
  void list_excludesUnpinnedViews() {
    Long owner = createUser("pinunp");
    var p = newProject(owner, "pinu");
    var pinnedView =
        savedViewService.create(owner, p.key(), req("고정함", "priority=HIGH", "PRIVATE"));
    var unpinnedView =
        savedViewService.create(owner, p.key(), req("미고정", "assignee=me", "PRIVATE"));
    savedViewService.togglePin(owner, p.key(), pinnedView.id(), true);

    var pinned = service.list(owner);

    assertThat(pinned).extracting(PinnedSavedViewResponse::id).contains(pinnedView.id());
    assertThat(pinned).extracting(PinnedSavedViewResponse::id).doesNotContain(unpinnedView.id());
  }

  /** 사용자가 프로젝트를 탈퇴하면 그 프로젝트의 고정뷰는 제외된다 (멤버십 재확인). */
  @Test
  void list_excludesViewsInProjectsUserLeft() {
    Long owner = createUser("pinlvo");
    Long member = createUser("pinlvm");
    var p = newProject(owner, "pinl");
    // 두 번째 사용자를 멤버로 추가 후, 그가 뷰를 만들고 고정한다.
    memberRepository.insert(p.id(), member, "MEMBER");
    var v = savedViewService.create(member, p.key(), req("탈퇴전", "priority=HIGH", "PRIVATE"));
    savedViewService.togglePin(member, p.key(), v.id(), true);

    // 멤버인 동안에는 목록에 포함된다 (멤버십 필터가 원인임을 증명하는 before 단언).
    assertThat(service.list(member)).extracting(PinnedSavedViewResponse::id).contains(v.id());

    // 멤버십 제거 후에는 제외된다.
    memberRepository.delete(p.id(), member);

    assertThat(service.list(member)).extracting(PinnedSavedViewResponse::id).doesNotContain(v.id());
  }
}
