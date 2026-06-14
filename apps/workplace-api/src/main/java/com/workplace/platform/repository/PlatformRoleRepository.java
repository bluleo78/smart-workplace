package com.workplace.platform.repository;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 플랫폼 평면 RBAC 조회/할당.
 *
 * <p>platform_role/platform_user_role/platform_role_permission 은 전역 테이블(RLS 비대상)이며 V70 에서 추가됐고
 * baseline jOOQ 코드젠에는 없으므로(워크트리에서 generateJooq 미수행) name-based DSL 로 접근한다.
 */
@Repository
@RequiredArgsConstructor
public class PlatformRoleRepository {

  private final DSLContext dsl;

  /** 사용자가 플랫폼 역할을 하나라도 보유하는지 — 운영자 평면 로그인/리프레시 게이트. */
  @Transactional(readOnly = true)
  public boolean hasAnyPlatformRole(Long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(DSL.table(DSL.name("platform_user_role")))
            .where(DSL.field(DSL.name("user_id"), Long.class).eq(userId)));
  }

  /** 사용자의 플랫폼 권한코드 목록(platform_user_role → platform_role_permission → permission). */
  @Transactional(readOnly = true)
  public List<String> findPermissionCodes(Long userId) {
    return dsl.selectDistinct(DSL.field(DSL.name("p", "code"), String.class))
        .from(DSL.table(DSL.name("platform_user_role")).as("pur"))
        .join(DSL.table(DSL.name("platform_role_permission")).as("prp"))
        .on(
            DSL.field(DSL.name("prp", "platform_role_id"), Long.class)
                .eq(DSL.field(DSL.name("pur", "platform_role_id"), Long.class)))
        .join(DSL.table(DSL.name("permission")).as("p"))
        .on(
            DSL.field(DSL.name("p", "id"), Long.class)
                .eq(DSL.field(DSL.name("prp", "permission_id"), Long.class)))
        .where(DSL.field(DSL.name("pur", "user_id"), Long.class).eq(userId))
        .fetchInto(String.class);
  }

  /** 사용자에게 SUPER_ADMIN 플랫폼 역할을 부여한다(중복 시 무시). 첫 유저 부트스트랩/백필용. */
  public void assignSuperAdmin(Long userId) {
    // platform_role_id 는 SUPER_ADMIN 역할의 id 를 스칼라 서브쿼리로 조회.
    // (INSERT...SELECT 형태는 name-based DSL 의 컬럼 타입 추론이 Record2<Object,Object> 와
    //  Record2<Long,Long> 로 어긋나 컴파일 실패 → values() + asField() 스칼라 서브쿼리로 대체)
    var superAdminId =
        dsl.select(DSL.field(DSL.name("id"), Long.class))
            .from(DSL.table(DSL.name("platform_role")))
            .where(DSL.field(DSL.name("name"), String.class).eq("SUPER_ADMIN"))
            .<Long>asField();

    dsl.insertInto(DSL.table(DSL.name("platform_user_role")))
        .columns(
            DSL.field(DSL.name("user_id"), Long.class),
            DSL.field(DSL.name("platform_role_id"), Long.class))
        .values(DSL.val(userId), superAdminId)
        // 충돌 대상을 PK(user_id, platform_role_id)로 명시 — 의도를 분명히 하고,
        // 향후 다른 unique 제약이 추가돼도 그쪽 충돌이 조용히 무시되지 않게 한다.
        .onConflict(DSL.field(DSL.name("user_id")), DSL.field(DSL.name("platform_role_id")))
        .doNothing()
        .execute();
  }
}
