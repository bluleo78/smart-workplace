package com.workplace.home.service;

import static com.workplace.home.SharedMemoryFixtures.addProjectMember;
import static com.workplace.home.SharedMemoryFixtures.addWikiMember;
import static com.workplace.home.SharedMemoryFixtures.grantAdmin;
import static com.workplace.home.SharedMemoryFixtures.project;
import static com.workplace.home.SharedMemoryFixtures.teamWiki;
import static com.workplace.home.SharedMemoryFixtures.user;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.home.exception.SharedAiMemoryException;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.service.WikiSpaceService;
import java.util.Set;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-386 스펙 3절 권한 표 전 칸 — 조직·프로젝트(OPEN·TEAM·PERSONAL, ADMIN 우회)·스페이스(VIEWER/EDITOR/OWNER, ADMIN 우회
 * 없음).
 */
@Transactional
class SharedMemorySpacesTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired SharedMemorySpaces spaces;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMembers;
  @Autowired WikiSpaceService wikiService;

  private SharedMemorySpaces.Access access(long uid, String type, Long id) {
    return spaces.access(uid, SpaceKey.of(type, id)).orElseThrow();
  }

  @Test
  void 조직은_누구나_읽고_관리자만_추가_관리한다() {
    long member = user(dsl);
    long admin = user(dsl);
    grantAdmin(dsl, admin);
    var m = access(member, "ORG", null);
    assertThat(m.canRead()).isTrue();
    assertThat(m.canAdd()).isFalse();
    assertThat(m.canManage()).isFalse();
    var a = access(admin, "ORG", null);
    assertThat(a.canAdd()).isTrue();
    assertThat(a.canManage()).isTrue();
    assertThat(a.space().label()).isEqualTo("조직");
  }

  @Test
  void TEAM_프로젝트_OWNER_MEMBER_비구성원_ADMIN() {
    long owner = user(dsl);
    long mem = user(dsl);
    long out = user(dsl);
    long admin = user(dsl);
    grantAdmin(dsl, admin);
    var p = project(projectService, owner, "SMT", "TEAM");
    addProjectMember(projectMembers, p.id(), mem);

    var o = access(owner, "PROJECT", p.id());
    assertThat(o.canRead()).isTrue();
    assertThat(o.canAdd()).isTrue();
    assertThat(o.canManage()).isTrue();
    assertThat(o.space().label()).isEqualTo("SMT 프로젝트(SMT)");

    var m = access(mem, "PROJECT", p.id());
    assertThat(m.canRead()).isTrue();
    assertThat(m.canAdd()).isTrue();
    assertThat(m.canManage()).isFalse();

    var x = access(out, "PROJECT", p.id());
    assertThat(x.canRead()).isFalse();
    assertThat(x.canAdd()).isFalse();

    var ad = access(admin, "PROJECT", p.id());
    assertThat(ad.canRead()).isTrue();
    assertThat(ad.canAdd()).isTrue();
    assertThat(ad.canManage()).isTrue();
  }

  @Test
  void OPEN_프로젝트는_비구성원도_읽지만_추가는_못_한다() {
    long owner = user(dsl);
    long out = user(dsl);
    var p = project(projectService, owner, "OPN", "OPEN");
    var x = access(out, "PROJECT", p.id());
    assertThat(x.canRead()).isTrue();
    assertThat(x.canAdd()).isFalse();
    assertThat(x.canManage()).isFalse();
  }

  @Test
  void PERSONAL_프로젝트와_없는_프로젝트는_공간이_아니다() {
    long owner = user(dsl);
    var p = project(projectService, owner, "PRS", "PERSONAL");
    assertThat(spaces.access(owner, SpaceKey.of("PROJECT", p.id()))).isEmpty();
    assertThat(spaces.access(owner, SpaceKey.of("PROJECT", 999_999L))).isEmpty();
  }

  @Test
  void 삭제된_프로젝트는_공간이_아니다() {
    long owner = user(dsl);
    var p = project(projectService, owner, "DEL", "TEAM");
    projectService.softDelete(owner, p.key());
    assertThat(spaces.access(owner, SpaceKey.of("PROJECT", p.id()))).isEmpty();
  }

  @Test
  void 스페이스_VIEWER_EDITOR_OWNER_와_ADMIN_우회_없음() {
    long owner = user(dsl);
    long viewer = user(dsl);
    long editor = user(dsl);
    long admin = user(dsl);
    grantAdmin(dsl, admin);
    long sid = teamWiki(wikiService, owner, "개발팀 노트");
    addWikiMember(wikiService, owner, sid, viewer, "VIEWER");
    addWikiMember(wikiService, owner, sid, editor, "EDITOR");

    var v = access(viewer, "WIKI_SPACE", sid);
    assertThat(v.canRead()).isTrue();
    assertThat(v.canAdd()).isFalse();
    var e = access(editor, "WIKI_SPACE", sid);
    assertThat(e.canAdd()).isTrue();
    assertThat(e.canManage()).isFalse();
    var o = access(owner, "WIKI_SPACE", sid);
    assertThat(o.canManage()).isTrue();
    assertThat(o.space().label()).isEqualTo("개발팀 노트");
    var a = access(admin, "WIKI_SPACE", sid);
    assertThat(a.canRead()).isFalse();
    assertThat(a.canManage()).isFalse();
  }

  @Test
  void 개인_노트_스페이스는_공간이_아니다() {
    long owner = user(dsl);
    long personal = wikiService.ensurePersonalSpace(owner).id();
    assertThat(spaces.access(owner, SpaceKey.of("WIKI_SPACE", personal))).isEmpty();
  }

  @Test
  void 본인_항목은_본인이_고치고_AI_항목은_관리자만() {
    long owner = user(dsl);
    long mem = user(dsl);
    var p = project(projectService, owner, "EDT", "TEAM");
    addProjectMember(projectMembers, p.id(), mem);
    var m = access(mem, "PROJECT", p.id());
    var o = access(owner, "PROJECT", p.id());
    assertThat(spaces.canEdit(m, mem, "USER_ADDED", mem)).isTrue();
    assertThat(spaces.canEdit(m, mem, "USER_REQUESTED", mem)).isTrue();
    assertThat(spaces.canEdit(m, mem, "USER_ADDED", owner)).isFalse();
    assertThat(spaces.canEdit(m, mem, "AI_EXTRACTED", null)).isFalse();
    assertThat(spaces.canEdit(o, owner, "AI_EXTRACTED", null)).isTrue();
    assertThat(spaces.canEdit(o, owner, "USER_ADDED", mem)).isTrue();
  }

  @Test
  void 읽지_못하는_공간은_404() {
    long owner = user(dsl);
    long out = user(dsl);
    var p = project(projectService, owner, "HID", "TEAM");
    assertThatThrownBy(() -> spaces.requireReadable(out, SpaceKey.of("PROJECT", p.id())))
        .isInstanceOfSatisfying(
            SharedAiMemoryException.class,
            e -> assertThat(e.code()).isEqualTo("SHARED_MEMORY_NOT_FOUND"));
  }

  @Test
  void 읽을_수_있는_공간_목록은_조직_프로젝트_스페이스_순이고_이름순이다() {
    long owner = user(dsl);
    long me = user(dsl);
    var b = project(projectService, owner, "BBB", "TEAM");
    var a = project(projectService, owner, "AAA", "OPEN");
    var c = project(projectService, owner, "CCC", "TEAM"); // 나는 구성원이 아님 — 빠진다
    addProjectMember(projectMembers, b.id(), me);
    long w = teamWiki(wikiService, owner, "가 노트");
    addWikiMember(wikiService, owner, w, me, "VIEWER");

    // 같은 테넌트에 다른 테스트가 커밋한 OPEN 프로젝트가 섞일 수 있어, 이 테스트가 만든 공간만 걸러 순서를 본다
    Set<String> mine = Set.of("ORG", "PROJECT:" + a.id(), "PROJECT:" + b.id(), "WIKI_SPACE:" + w);
    var list = spaces.readable(me);
    assertThat(list)
        .extracting(x -> x.space().param())
        .filteredOn(mine::contains)
        .containsExactly("ORG", "PROJECT:" + a.id(), "PROJECT:" + b.id(), "WIKI_SPACE:" + w);
    // 구성원이 아닌 TEAM 프로젝트(CCC)는 어떤 경우에도 목록에 없다
    assertThat(list).extracting(x -> x.space().param()).doesNotContain("PROJECT:" + c.id());
  }

  @Test
  void 메시지_공간_검증은_TEAM_OPEN_읽기_가능_프로젝트와_구성원_TEAM_스페이스만() {
    long owner = user(dsl);
    long out = user(dsl);
    var team = project(projectService, owner, "VRF", "TEAM");
    long w = teamWiki(wikiService, owner, "검증 노트");
    assertThat(spaces.verifyForMessage(owner, "PROJECT", "VRF", null)).isPresent();
    assertThat(spaces.verifyForMessage(out, "PROJECT", "VRF", null)).isEmpty(); // 위조: 못 읽는 프로젝트
    assertThat(spaces.verifyForMessage(owner, "WIKI_SPACE", null, w)).isPresent();
    assertThat(spaces.verifyForMessage(out, "WIKI_SPACE", null, w)).isEmpty();
    assertThat(spaces.verifyForMessage(owner, "ORG", null, null)).isEmpty(); // 조직은 메시지 공간이 아니다
    assertThat(spaces.verifyForMessage(owner, "PROJECT", "NOPE", null)).isEmpty();
    assertThat(spaces.verifyForMessage(owner, "PROJECT", null, team.id())).isEmpty(); // 프로젝트는 키로만
  }
}
