package com.workplace.view.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.view.dto.SaveViewRequest;
import com.workplace.view.dto.SavedViewResponse;
import com.workplace.view.exception.SavedViewAccessDeniedException;
import com.workplace.view.exception.SavedViewNameDuplicatedException;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** SavedViewService 통합 테스트 — 가시성 격리, 소유/공유 권한, CRUD, 중복. */
@Transactional
class SavedViewServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired SavedViewService service;
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
  void member_creates_private_view_and_marks_mine() {
    Long owner = createUser("v");
    ProjectResponse p = newProject(owner, "VA");
    var resp = service.create(owner, p.key(), req("내 HIGH", "priority=HIGH", "PRIVATE"));
    assertThat(resp.name()).isEqualTo("내 HIGH");
    assertThat(resp.query()).isEqualTo("priority=HIGH");
    assertThat(resp.visibility()).isEqualTo("PRIVATE");
    assertThat(resp.mine()).isTrue();
  }

  @Test
  void private_view_hidden_from_others_shared_visible() {
    Long owner = createUser("vo");
    Long member = createUser("vm");
    ProjectResponse p = newProject(owner, "VB");
    memberRepository.insert(p.id(), member, "MEMBER");
    service.create(owner, p.key(), req("owner-private", "q=x", "PRIVATE"));
    service.create(owner, p.key(), req("owner-shared", "q=y", "SHARED"));

    var memberSees = service.list(member, p.key());
    assertThat(memberSees).extracting(SavedViewResponse::name).containsExactly("owner-shared");
    var ownerSees = service.list(owner, p.key());
    assertThat(ownerSees)
        .extracting(SavedViewResponse::name)
        .containsExactlyInAnyOrder("owner-private", "owner-shared");
  }

  @Test
  void mine_flag_false_for_others_shared_view() {
    Long owner = createUser("vo2");
    Long member = createUser("vm2");
    ProjectResponse p = newProject(owner, "VC");
    memberRepository.insert(p.id(), member, "MEMBER");
    service.create(owner, p.key(), req("shared", "q=z", "SHARED"));
    var seen = service.list(member, p.key());
    assertThat(seen).hasSize(1);
    assertThat(seen.get(0).mine()).isFalse();
  }

  @Test
  void non_owner_member_cannot_update_others_view() {
    Long owner = createUser("vo3");
    Long member = createUser("vm3");
    ProjectResponse p = newProject(owner, "VD");
    memberRepository.insert(p.id(), member, "MEMBER");
    var v = service.create(owner, p.key(), req("shared", "q=a", "SHARED"));
    assertThatThrownBy(() -> service.update(member, p.key(), v.id(), req("hack", "q=b", "SHARED")))
        .isInstanceOf(SavedViewAccessDeniedException.class);
  }

  @Test
  void project_owner_can_delete_shared_view_of_other() {
    Long owner = createUser("vo4");
    Long member = createUser("vm4");
    ProjectResponse p = newProject(owner, "VE");
    memberRepository.insert(p.id(), member, "MEMBER");
    var v = service.create(member, p.key(), req("m-shared", "q=c", "SHARED"));
    service.delete(owner, p.key(), v.id());
    assertThat(service.list(owner, p.key())).isEmpty();
  }

  @Test
  void duplicate_name_same_owner_throws_409() {
    Long owner = createUser("vo5");
    ProjectResponse p = newProject(owner, "VF");
    service.create(owner, p.key(), req("dup", "q=1", "PRIVATE"));
    assertThatThrownBy(() -> service.create(owner, p.key(), req("dup", "q=2", "PRIVATE")))
        .isInstanceOf(SavedViewNameDuplicatedException.class);
  }

  @Test
  void list_requires_membership() {
    Long owner = createUser("vo6");
    Long outsider = createUser("out6");
    ProjectResponse p = newProject(owner, "VG");
    assertThatThrownBy(() -> service.list(outsider, p.key()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }

  @Test
  void owner_can_delete_own_private_view() {
    Long owner = createUser("vo-del");
    ProjectResponse p = newProject(owner, "VH");
    var v = service.create(owner, p.key(), req("mine", "q=1", "PRIVATE"));
    service.delete(owner, p.key(), v.id());
    assertThat(service.list(owner, p.key())).isEmpty();
  }

  @Test
  void project_owner_cannot_delete_private_view_of_other() {
    Long owner = createUser("vo-priv");
    Long member = createUser("vm-priv");
    ProjectResponse p = newProject(owner, "VI");
    memberRepository.insert(p.id(), member, "MEMBER");
    var v = service.create(member, p.key(), req("m-private", "q=d", "PRIVATE"));
    assertThatThrownBy(() -> service.delete(owner, p.key(), v.id()))
        .isInstanceOf(SavedViewAccessDeniedException.class);
  }

  @Test
  void non_owner_member_cannot_delete_others_view() {
    Long owner = createUser("vo-nd");
    Long member = createUser("vm-nd");
    ProjectResponse p = newProject(owner, "VJ");
    memberRepository.insert(p.id(), member, "MEMBER");
    var v = service.create(owner, p.key(), req("shared", "q=e", "SHARED"));
    assertThatThrownBy(() -> service.delete(member, p.key(), v.id()))
        .isInstanceOf(SavedViewAccessDeniedException.class);
  }
}
