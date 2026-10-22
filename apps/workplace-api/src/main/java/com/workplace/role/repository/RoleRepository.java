package com.workplace.role.repository;

import static com.workplace.jooq.Tables.*;

import com.workplace.role.dto.AdminPermissionCodes;
import com.workplace.role.dto.RoleResponse;
import com.workplace.user.dto.UserKind;
import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class RoleRepository {

  private final DSLContext dsl;

  private RoleResponse mapToRoleResponse(Record r) {
    return new RoleResponse(
        r.get(ROLE.ID), r.get(ROLE.NAME), r.get(ROLE.DESCRIPTION), r.get(ROLE.IS_SYSTEM));
  }

  /**
   * 역할 목록 — 각 역할이 관리 권한을 주는지(grantsAdmin, WP-728)를 함께 싣는다. ADMIN 시스템 역할은 권한 행과 상관없이 관리 역할로 본다(ADMIN
   * 은 권한 판정을 우회한다).
   */
  public List<RoleResponse> findAll() {
    Field<Boolean> grantsAdmin =
        DSL.field(
            DSL.exists(
                    DSL.selectOne()
                        .from(ROLE_PERMISSION)
                        .join(PERMISSION)
                        .on(PERMISSION.ID.eq(ROLE_PERMISSION.PERMISSION_ID))
                        .where(ROLE_PERMISSION.ROLE_ID.eq(ROLE.ID))
                        .and(PERMISSION.CODE.in(AdminPermissionCodes.CODES)))
                .or(ROLE.IS_SYSTEM.isTrue().and(ROLE.NAME.eq("ADMIN"))));
    return dsl.select(ROLE.ID, ROLE.NAME, ROLE.DESCRIPTION, ROLE.IS_SYSTEM, grantsAdmin)
        .from(ROLE)
        .orderBy(ROLE.ID.asc())
        .fetch(
            r ->
                new RoleResponse(
                    r.get(ROLE.ID),
                    r.get(ROLE.NAME),
                    r.get(ROLE.DESCRIPTION),
                    r.get(ROLE.IS_SYSTEM),
                    Boolean.TRUE.equals(r.get(grantsAdmin))));
  }

  public Optional<RoleResponse> findById(Long id) {
    return dsl.select(ROLE.ID, ROLE.NAME, ROLE.DESCRIPTION, ROLE.IS_SYSTEM)
        .from(ROLE)
        .where(ROLE.ID.eq(id))
        .fetchOptional(this::mapToRoleResponse);
  }

  public Optional<RoleResponse> findByName(String name) {
    return dsl.select(ROLE.ID, ROLE.NAME, ROLE.DESCRIPTION, ROLE.IS_SYSTEM)
        .from(ROLE)
        .where(ROLE.NAME.eq(name))
        .fetchOptional(this::mapToRoleResponse);
  }

  public boolean existsByName(String name) {
    return dsl.fetchExists(dsl.selectOne().from(ROLE).where(ROLE.NAME.eq(name)));
  }

  public RoleResponse save(String name, String description) {
    return dsl.insertInto(ROLE)
        .set(ROLE.NAME, name)
        .set(ROLE.DESCRIPTION, description)
        .returning(ROLE.ID, ROLE.NAME, ROLE.DESCRIPTION, ROLE.IS_SYSTEM)
        .fetchOne(this::mapToRoleResponse);
  }

  public void update(Long id, String name, String description) {
    dsl.update(ROLE)
        .set(ROLE.NAME, name)
        .set(ROLE.DESCRIPTION, description)
        .set(ROLE.UPDATED_AT, LocalDateTime.now())
        .where(ROLE.ID.eq(id))
        .execute();
  }

  public void deleteById(Long id) {
    dsl.deleteFrom(ROLE).where(ROLE.ID.eq(id)).execute();
  }

  public void addPermission(Long roleId, Long permissionId) {
    dsl.insertInto(ROLE_PERMISSION)
        .set(ROLE_PERMISSION.ROLE_ID, roleId)
        .set(ROLE_PERMISSION.PERMISSION_ID, permissionId)
        .execute();
  }

  public void removePermission(Long roleId, Long permissionId) {
    dsl.deleteFrom(ROLE_PERMISSION)
        .where(
            ROLE_PERMISSION.ROLE_ID.eq(roleId).and(ROLE_PERMISSION.PERMISSION_ID.eq(permissionId)))
        .execute();
  }

  public void setPermissions(Long roleId, List<Long> permissionIds) {
    dsl.deleteFrom(ROLE_PERMISSION).where(ROLE_PERMISSION.ROLE_ID.eq(roleId)).execute();

    if (!permissionIds.isEmpty()) {
      var insert =
          dsl.insertInto(ROLE_PERMISSION, ROLE_PERMISSION.ROLE_ID, ROLE_PERMISSION.PERMISSION_ID);
      // WP-821: 같은 id 가 두 번 오면 기본 키 충돌(409)이 났다 — 집합 교체이므로 순서를 지켜 한 번씩만 넣는다.
      for (Long permissionId : new LinkedHashSet<>(permissionIds)) {
        insert = insert.values(roleId, permissionId);
      }
      insert.execute();
    }
  }

  /** 해당 역할이 현재 할당되어 있는 사용자 수 — 삭제 전 영향 범위 확인용 (#678). */
  public int countAssignedUsers(Long roleId) {
    return dsl.fetchCount(dsl.selectOne().from(USER_ROLE).where(USER_ROLE.ROLE_ID.eq(roleId)));
  }

  /** 해당 역할을 가진 AI 에이전트 수 — AI 가 가진 역할에 관리 권한을 더하지 못하게 할 때 쓴다(WP-728). */
  public int countAgentHolders(Long roleId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(USER_ROLE)
            .join(USER)
            .on(USER.ID.eq(USER_ROLE.USER_ID))
            .where(USER_ROLE.ROLE_ID.eq(roleId))
            .and(USER.KIND.eq(UserKind.AGENT)));
  }

  public List<RoleResponse> findByUserId(Long userId) {
    return dsl.select(ROLE.ID, ROLE.NAME, ROLE.DESCRIPTION, ROLE.IS_SYSTEM)
        .from(ROLE)
        .join(USER_ROLE)
        .on(USER_ROLE.ROLE_ID.eq(ROLE.ID))
        .where(USER_ROLE.USER_ID.eq(userId))
        .orderBy(ROLE.ID.asc())
        .fetch(this::mapToRoleResponse);
  }
}
