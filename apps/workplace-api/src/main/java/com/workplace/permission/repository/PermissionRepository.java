package com.workplace.permission.repository;

import static com.workplace.jooq.Tables.*;

import com.workplace.permission.dto.PermissionResponse;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Table;
import org.jooq.impl.DSL;
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
   * 유효 권한 코드 = 역할 경유 권한 ∪ 멤버 기본 권한(#861) — 단, <b>해당 테넌트의 ACTIVE 멤버일 때만</b>(WP-420). 멤버가 아니거나 멤버십이
   * 정지(SUSPENDED)면 {@link Optional#empty()} 를 돌려준다(역할 권한도 붙지 않는다).
   *
   * <p>인증 필터가 요청마다 부르므로 멤버십 판정과 권한 조회를 별도 왕복 없이 한 쿼리로 합친다: ACTIVE 멤버십 행을 기준으로 권한 코드 합집합(UNION)을
   * LEFT JOIN 한다. 행이 0개 → ACTIVE 멤버 아님, 코드가 NULL 인 1행 → ACTIVE 멤버지만 권한 없음. 판정을 "기본 권한이 있는가"로 유추하지
   * 않는다 — 권한 카탈로그가 바뀌면 조용히 깨지기 때문이다. 기본 권한 코드는 permission 카탈로그에 있는 것만 나온다.
   */
  public Optional<Set<String>> findActiveMemberPermissionCodes(
      Long userId, long tenantId, Set<String> memberBaselineCodes) {
    Table<?> codes =
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
                    .where(PERMISSION.CODE.in(memberBaselineCodes)))
            .asTable("effective_codes");
    Field<String> code = codes.field(PERMISSION.CODE);
    List<String> rows =
        dsl.select(code)
            .from(MEMBERSHIP)
            .leftJoin(codes)
            .on(DSL.trueCondition())
            .where(MEMBERSHIP.USER_ID.eq(userId))
            .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
            .and(MEMBERSHIP.STATUS.eq("ACTIVE"))
            .fetch(code);
    if (rows.isEmpty()) return Optional.empty();
    // ACTIVE 멤버지만 권한이 없으면 코드가 NULL 인 1행이 온다 — NULL 을 걸러 빈 집합으로 만든다.
    return Optional.of(rows.stream().filter(Objects::nonNull).collect(Collectors.toSet()));
  }
}
