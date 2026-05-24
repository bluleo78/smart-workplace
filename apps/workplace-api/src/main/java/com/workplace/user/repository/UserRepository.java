package com.workplace.user.repository;

import static com.workplace.jooq.Tables.*;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.trueCondition;
import static org.jooq.impl.DSL.val;

import com.workplace.global.util.LikePatternUtils;
import com.workplace.user.dto.UserResponse;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class UserRepository {

  private final DSLContext dsl;

  private UserResponse mapToUserResponse(Record r) {
    // Phase 5a: kind 컬럼을 마지막 인자로 함께 노출 (HUMAN | AGENT)
    return new UserResponse(
        r.get(USER.ID),
        r.get(USER.USERNAME),
        r.get(USER.EMAIL),
        r.get(USER.NAME),
        r.get(USER.IS_ACTIVE),
        r.get(USER.CREATED_AT),
        r.get(USER.KIND));
  }

  public Optional<UserResponse> findByUsername(String username) {
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .from(USER)
        .where(USER.USERNAME.eq(username))
        .fetchOptional(this::mapToUserResponse);
  }

  /** id 집합으로 일괄 조회 (N+1 회피). 빈 입력은 빈 리스트 반환. */
  public List<UserResponse> findByIds(List<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .from(USER)
        .where(USER.ID.in(ids))
        .fetch(this::mapToUserResponse);
  }

  public Optional<UserResponse> findById(Long id) {
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .from(USER)
        .where(USER.ID.eq(id))
        .fetchOptional(this::mapToUserResponse);
  }

  /** kind 별 사용자 목록 (예: 모든 AGENT). 이름 오름차순. */
  public List<UserResponse> findByKind(String kind) {
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .from(USER)
        .where(USER.KIND.eq(kind))
        .orderBy(USER.NAME.asc(), USER.ID.asc())
        .fetch(this::mapToUserResponse);
  }

  public Optional<String> findPasswordByUsername(String username) {
    return dsl.select(USER.PASSWORD)
        .from(USER)
        .where(USER.USERNAME.eq(username))
        .fetchOptional(r -> r.get(USER.PASSWORD));
  }

  public Optional<String> findPasswordById(Long id) {
    return dsl.select(USER.PASSWORD)
        .from(USER)
        .where(USER.ID.eq(id))
        .fetchOptional(r -> r.get(USER.PASSWORD));
  }

  public boolean existsByUsername(String username) {
    return dsl.fetchExists(dsl.selectOne().from(USER).where(USER.USERNAME.eq(username)));
  }

  public boolean existsByEmail(String email) {
    return dsl.fetchExists(dsl.selectOne().from(USER).where(USER.EMAIL.eq(email)));
  }

  public boolean existsByEmailExcludingUser(String email, Long excludeUserId) {
    return dsl.fetchExists(
        dsl.selectOne().from(USER).where(USER.EMAIL.eq(email).and(USER.ID.ne(excludeUserId))));
  }

  public boolean existsById(Long id) {
    return dsl.fetchExists(dsl.selectOne().from(USER).where(USER.ID.eq(id)));
  }

  /**
   * Acquire a transaction-scoped advisory lock for first-user detection. Serializes concurrent
   * signup requests that might race for ADMIN role assignment. The lock is automatically released
   * when the transaction ends.
   */
  public void acquireFirstUserLock() {
    dsl.execute("SELECT pg_advisory_xact_lock({0})", val(1L));
  }

  public UserResponse save(String username, String email, String password, String name) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.EMAIL, email)
        .set(USER.PASSWORD, password)
        .set(USER.NAME, name)
        .returning(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .fetchOne(this::mapToUserResponse);
  }

  /**
   * AGENT 유저 생성 — password=NULL, kind='AGENT'. AGENT 는 로그인 흐름을 사용할 수 없고 API 키로만 인증한다.
   *
   * @return 생성된 사용자 응답
   */
  public UserResponse createAgent(String username, String email, String name) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.EMAIL, email)
        .set(USER.NAME, name)
        .set(USER.KIND, com.workplace.user.dto.UserKind.AGENT)
        .setNull(USER.PASSWORD)
        .returning(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .fetchOne(this::mapToUserResponse);
  }

  public List<UserResponse> findAllPaginated(String search, int page, int size) {
    Condition condition = trueCondition();

    if (search != null && !search.isBlank()) {
      String pattern = LikePatternUtils.containsPattern(search);
      condition =
          condition.and(
              USER.USERNAME
                  .likeIgnoreCase(pattern, '\\')
                  .or(USER.NAME.likeIgnoreCase(pattern, '\\'))
                  .or(USER.EMAIL.likeIgnoreCase(pattern, '\\')));
    }

    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .from(USER)
        .where(condition)
        .orderBy(USER.ID.asc())
        .limit(size)
        .offset(page * size)
        .fetch(this::mapToUserResponse);
  }

  public long countAll(String search) {
    Condition condition = trueCondition();

    if (search != null && !search.isBlank()) {
      String pattern = LikePatternUtils.containsPattern(search);
      condition =
          condition.and(
              USER.USERNAME
                  .likeIgnoreCase(pattern, '\\')
                  .or(USER.NAME.likeIgnoreCase(pattern, '\\'))
                  .or(USER.EMAIL.likeIgnoreCase(pattern, '\\')));
    }

    return dsl.select(count()).from(USER).where(condition).fetchOne(0, Long.class);
  }

  public void update(Long id, String name, String email) {
    dsl.update(USER)
        .set(USER.NAME, name)
        .set(USER.EMAIL, email)
        .set(USER.UPDATED_AT, LocalDateTime.now())
        .where(USER.ID.eq(id))
        .execute();
  }

  public void updatePassword(Long id, String encodedPassword) {
    dsl.update(USER)
        .set(USER.PASSWORD, encodedPassword)
        .set(USER.UPDATED_AT, LocalDateTime.now())
        .where(USER.ID.eq(id))
        .execute();
  }

  /** id 로 사용자 삭제 (CASCADE). Phase 5a AGENT 삭제용 — 일반 HUMAN 에는 사용 금지. */
  public void deleteById(Long id) {
    dsl.deleteFrom(USER).where(USER.ID.eq(id)).execute();
  }

  public void setActive(Long id, boolean active) {
    dsl.update(USER)
        .set(USER.IS_ACTIVE, active)
        .set(USER.UPDATED_AT, LocalDateTime.now())
        .where(USER.ID.eq(id))
        .execute();
  }

  /**
   * 활성 ADMIN 사용자 수를 반환한다. 마지막 ADMIN 비활성화 방지 체크에 사용 (#146).
   *
   * @return is_active=true 이고 ADMIN 역할을 가진 사용자 수
   */
  public int countActiveAdmins() {
    return dsl.select(count())
        .from(USER)
        .join(USER_ROLE)
        .on(USER_ROLE.USER_ID.eq(USER.ID))
        .join(ROLE)
        .on(ROLE.ID.eq(USER_ROLE.ROLE_ID))
        .where(ROLE.NAME.eq("ADMIN").and(USER.IS_ACTIVE.isTrue()))
        .fetchOne(0, Integer.class);
  }

  /**
   * 특정 사용자가 ADMIN 역할을 갖고 있는지 확인한다. 마지막 ADMIN 비활성화 방지 체크에 사용 (#146).
   *
   * @param userId 확인할 사용자 ID
   * @return 해당 사용자가 ADMIN 역할을 보유하면 true
   */
  public boolean hasAdminRole(Long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(USER_ROLE)
            .join(ROLE)
            .on(ROLE.ID.eq(USER_ROLE.ROLE_ID))
            .where(USER_ROLE.USER_ID.eq(userId).and(ROLE.NAME.eq("ADMIN"))));
  }

  public void addRole(Long userId, Long roleId) {
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  public void removeRole(Long userId, Long roleId) {
    dsl.deleteFrom(USER_ROLE)
        .where(USER_ROLE.USER_ID.eq(userId).and(USER_ROLE.ROLE_ID.eq(roleId)))
        .execute();
  }

  public void setRoles(Long userId, List<Long> roleIds) {
    dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.eq(userId)).execute();

    if (!roleIds.isEmpty()) {
      var insert = dsl.insertInto(USER_ROLE, USER_ROLE.USER_ID, USER_ROLE.ROLE_ID);
      for (Long roleId : roleIds) {
        insert = insert.values(userId, roleId);
      }
      insert.execute();
    }
  }
}
