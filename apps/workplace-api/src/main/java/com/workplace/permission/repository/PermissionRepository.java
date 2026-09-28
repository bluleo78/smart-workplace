package com.workplace.permission.repository;

import static com.workplace.jooq.Tables.*;

import com.workplace.permission.dto.PermissionResponse;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class PermissionRepository {

  private final DSLContext dsl;

  private PermissionResponse mapToPermissionResponse(Record r) {
    return new PermissionResponse(
        r.get(PERMISSION.ID),
        r.get(PERMISSION.CODE),
        r.get(PERMISSION.DESCRIPTION),
        r.get(PERMISSION.CATEGORY));
  }

  public List<PermissionResponse> findAll() {
    return dsl.select(PERMISSION.ID, PERMISSION.CODE, PERMISSION.DESCRIPTION, PERMISSION.CATEGORY)
        .from(PERMISSION)
        .orderBy(PERMISSION.ID.asc())
        .fetch(this::mapToPermissionResponse);
  }

  public List<PermissionResponse> findByCategory(String category) {
    return dsl.select(PERMISSION.ID, PERMISSION.CODE, PERMISSION.DESCRIPTION, PERMISSION.CATEGORY)
        .from(PERMISSION)
        .where(PERMISSION.CATEGORY.eq(category))
        .orderBy(PERMISSION.ID.asc())
        .fetch(this::mapToPermissionResponse);
  }

  public Optional<PermissionResponse> findById(Long id) {
    return dsl.select(PERMISSION.ID, PERMISSION.CODE, PERMISSION.DESCRIPTION, PERMISSION.CATEGORY)
        .from(PERMISSION)
        .where(PERMISSION.ID.eq(id))
        .fetchOptional(this::mapToPermissionResponse);
  }

  public Optional<PermissionResponse> findByCode(String code) {
    return dsl.select(PERMISSION.ID, PERMISSION.CODE, PERMISSION.DESCRIPTION, PERMISSION.CATEGORY)
        .from(PERMISSION)
        .where(PERMISSION.CODE.eq(code))
        .fetchOptional(this::mapToPermissionResponse);
  }

  public List<PermissionResponse> findByRoleId(Long roleId) {
    return dsl.select(PERMISSION.ID, PERMISSION.CODE, PERMISSION.DESCRIPTION, PERMISSION.CATEGORY)
        .from(PERMISSION)
        .join(ROLE_PERMISSION)
        .on(ROLE_PERMISSION.PERMISSION_ID.eq(PERMISSION.ID))
        .where(ROLE_PERMISSION.ROLE_ID.eq(roleId))
        .orderBy(PERMISSION.ID.asc())
        .fetch(this::mapToPermissionResponse);
  }

  public Set<String> findPermissionCodesByUserId(Long userId) {
    List<String> codes =
        dsl.selectDistinct(PERMISSION.CODE)
            .from(PERMISSION)
            .join(ROLE_PERMISSION)
            .on(ROLE_PERMISSION.PERMISSION_ID.eq(PERMISSION.ID))
            .join(USER_ROLE)
            .on(USER_ROLE.ROLE_ID.eq(ROLE_PERMISSION.ROLE_ID))
            .where(USER_ROLE.USER_ID.eq(userId))
            .fetch(r -> r.get(PERMISSION.CODE));
    return new HashSet<>(codes);
  }

  /**
   * 유효 권한 코드 = 역할 경유 권한 ∪ (해당 테넌트 ACTIVE 멤버면) 멤버 기본 권한(#861). 인증 필터가 요청마다 부르므로 멤버십 판정을 별도 왕복 없이 한
   * 쿼리(UNION + EXISTS)로 합친다. 기본 권한 코드는 permission 카탈로그에 있는 것만 나온다.
   */
  public Set<String> findEffectivePermissionCodes(
      Long userId, long tenantId, Set<String> memberBaselineCodes) {
    List<String> codes =
        dsl.select(PERMISSION.CODE)
            .from(PERMISSION)
            .join(ROLE_PERMISSION)
            .on(ROLE_PERMISSION.PERMISSION_ID.eq(PERMISSION.ID))
            .join(USER_ROLE)
            .on(USER_ROLE.ROLE_ID.eq(ROLE_PERMISSION.ROLE_ID))
            .where(USER_ROLE.USER_ID.eq(userId))
            .union(
                dsl.select(PERMISSION.CODE)
                    .from(PERMISSION)
                    .where(PERMISSION.CODE.in(memberBaselineCodes))
                    .andExists(
                        dsl.selectOne()
                            .from(MEMBERSHIP)
                            .where(MEMBERSHIP.USER_ID.eq(userId))
                            .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
                            .and(MEMBERSHIP.STATUS.eq("ACTIVE"))))
            .fetch(PERMISSION.CODE);
    return new HashSet<>(codes);
  }
}
