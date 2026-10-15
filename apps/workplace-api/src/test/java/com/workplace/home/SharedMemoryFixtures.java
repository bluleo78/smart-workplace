package com.workplace.home;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.service.WikiSpaceService;
import org.jooq.DSLContext;

/** WP-386 공용 메모리 테스트 도우미 — 사용자·ADMIN·프로젝트(TEAM/OPEN/PERSONAL)·팀 노트 스페이스·구성원. 테넌트 1 트랜잭션 안에서 부른다. */
public final class SharedMemoryFixtures {

  private SharedMemoryFixtures() {}

  /**
   * 테넌트 1 의 ACTIVE 구성원인 사람. createHuman 만으로는 테넌트 구성원이 아니라 스페이스·프로젝트 구성원 추가가 MembershipGuard 에 막혀서
   * membership 도 함께 넣는다.
   */
  public static long user(DSLContext dsl) {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, id, 1L);
    return id;
  }

  /** RBAC ADMIN 역할을 준다(ProjectAccessGuardTest 와 같은 방식). */
  public static void grantAdmin(DSLContext dsl, long userId) {
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  /** 프로젝트 — 만든 사람이 OWNER. PERSONAL 은 key 를 서버가 정하므로 null 을 넘긴다. */
  public static ProjectResponse project(ProjectService svc, long owner, String key, String type) {
    return svc.create(
        owner,
        new CreateProjectRequest("PERSONAL".equals(type) ? null : key, key + " 프로젝트", null, type));
  }

  /** 프로젝트 MEMBER 로 넣는다. */
  public static void addProjectMember(ProjectMemberRepository repo, long projectId, long userId) {
    repo.insert(projectId, userId, "MEMBER");
  }

  /** 팀 노트 스페이스 — 만든 사람이 OWNER. */
  public static long teamWiki(WikiSpaceService svc, long owner, String name) {
    return svc.createTeamSpace(owner, name).id();
  }

  /** 스페이스 구성원(VIEWER·EDITOR·OWNER) 추가 — owner 권한으로. */
  public static void addWikiMember(
      WikiSpaceService svc, long owner, long spaceId, long userId, String role) {
    svc.addMember(owner, spaceId, userId, role);
  }
}
