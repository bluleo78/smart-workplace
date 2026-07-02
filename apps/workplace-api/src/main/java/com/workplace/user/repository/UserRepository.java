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

  /** 이메일로 사용자 조회 (대소문자 무시). */
  public Optional<UserResponse> findByEmailIgnoreCase(String email) {
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .from(USER)
        .where(USER.EMAIL.equalIgnoreCase(email))
        .limit(1)
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
  /**
   * kind 별 사용자 목록을 active 테넌트로 스코프한다. user 는 전역 테이블이라 RLS 가 걸리지 않으므로 membership 조인으로 명시적으로 테넌트 멤버만
   * 거른다(다른 테넌트 AGENT 누출 방지). membership.(user_id, tenant_id) 는 유일하므로 행 중복 없음.
   */
  public List<UserResponse> findByKind(Long tenantId, String kind) {
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .from(USER)
        .join(MEMBERSHIP)
        .on(USER.ID.eq(MEMBERSHIP.USER_ID))
        .where(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .and(USER.KIND.eq(kind))
        .orderBy(USER.NAME.asc(), USER.ID.asc())
        .fetch(this::mapToUserResponse);
  }

  /**
   * AGENT 목록을 active 테넌트로 스코프한다. includePersonal=false 면 개인 비서로 자동 생성된 AGENT(username 접두어
   * `__assistant_u`)를 제외한다 — 개인 비서는 사용자별 비공개이며 각자 /settings/assistant 에서 관리하므로 워크스페이스 에이전트 관리 목록의
   * 기본 노출 대상이 아니다. (접두어는 PersonalAssistantService.ensurePersonalAgent 의 생성 규칙과 일치.)
   */
  public List<com.workplace.user.dto.AgentResponse> findAgents(
      Long tenantId, boolean includePersonal) {
    // 개인 비서 소유자(사람) 이름을 얻기 위한 self-join: owner.personal_assistant_agent_id = agent.id.
    com.workplace.jooq.tables.User owner = USER.as("owner");
    Condition where =
        MEMBERSHIP.TENANT_ID.eq(tenantId).and(USER.KIND.eq(com.workplace.user.dto.UserKind.AGENT));
    if (!includePersonal) {
      // startsWith 는 LIKE 와일드카드를 이스케이프하므로 `__` 가 임의문자로 해석되지 않는다.
      where =
          where.and(
              USER.USERNAME
                  .startsWith(com.workplace.user.dto.AgentUsernames.PERSONAL_ASSISTANT_PREFIX)
                  .not());
    }
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            owner.NAME,
            WORKSPACE_ASSISTANT.AGENT_USER_ID)
        .from(USER)
        .join(MEMBERSHIP)
        .on(USER.ID.eq(MEMBERSHIP.USER_ID))
        // 소유자(개인 비서 주인) — 없으면 null.
        .leftJoin(owner)
        .on(owner.PERSONAL_ASSISTANT_AGENT_ID.eq(USER.ID))
        // 이 테넌트의 공통 비서로 지정됐는지(RLS 로 현재 테넌트 행만 보임).
        .leftJoin(WORKSPACE_ASSISTANT)
        .on(WORKSPACE_ASSISTANT.AGENT_USER_ID.eq(USER.ID))
        .where(where)
        .orderBy(USER.NAME.asc(), USER.ID.asc())
        .fetch(
            r -> {
              String username = r.get(USER.USERNAME);
              String ownerName = r.get(owner.NAME);
              Long wsAgentId = r.get(WORKSPACE_ASSISTANT.AGENT_USER_ID);
              // 유형 우선순위: 개인(__assistant_u 접두어) > 공통(지정) > 일반.
              boolean isPersonal =
                  com.workplace.user.dto.AgentUsernames.isPersonalAssistant(username);
              String type =
                  isPersonal
                      ? com.workplace.user.dto.AgentResponse.TYPE_PERSONAL
                      : (wsAgentId != null
                          ? com.workplace.user.dto.AgentResponse.TYPE_WORKSPACE
                          : com.workplace.user.dto.AgentResponse.TYPE_REGULAR);
              return new com.workplace.user.dto.AgentResponse(
                  r.get(USER.ID),
                  username,
                  r.get(USER.EMAIL),
                  r.get(USER.NAME),
                  Boolean.TRUE.equals(r.get(USER.IS_ACTIVE)),
                  r.get(USER.CREATED_AT),
                  type,
                  isPersonal ? ownerName : null);
            });
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

  /** username 중복 검사 — 자신(excludeUserId)은 제외. 관리자 rename 시 이름 무변경도 통과시키기 위함. */
  public boolean existsByUsernameExcludingUser(String username, Long excludeUserId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(USER)
            .where(USER.USERNAME.eq(username).and(USER.ID.ne(excludeUserId))));
  }

  /**
   * AGENT 의 식별자(username)와 표시 이름(name)만 변경한다. email/password 등 다른 필드는 절대 건드리지 않는다(관리자 rename 전용).
   */
  public void renameAgentIdentity(Long id, String username, String name) {
    dsl.update(USER)
        .set(USER.USERNAME, username)
        .set(USER.NAME, name)
        .set(USER.UPDATED_AT, LocalDateTime.now())
        .where(USER.ID.eq(id))
        .execute();
  }

  /** 표시 이름(name)만 변경한다 — 개인 비서 이름 변경 등. email/username 은 보존. */
  public void updateName(Long id, String name) {
    dsl.update(USER)
        .set(USER.NAME, name)
        .set(USER.UPDATED_AT, LocalDateTime.now())
        .where(USER.ID.eq(id))
        .execute();
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

  /** 개인 비서용 AGENT user 생성(로그인 불가, password NULL). 생성된 id 반환. */
  public long createPersonalAssistantAgent(String username, String email) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.EMAIL, email)
        .set(USER.NAME, "개인 비서")
        .set(USER.KIND, com.workplace.user.dto.UserKind.AGENT)
        .setNull(USER.PASSWORD)
        .returning(USER.ID)
        .fetchOne(USER.ID);
  }

  /**
   * 사용자 목록을 active 테넌트로 스코프한다(설정 > 사용자 관리). user 는 전역 테이블이라 RLS 가 걸리지 않으므로 membership 조인으로 명시적으로
   * 테넌트 멤버만 거른다(다른 테넌트 사용자 누출 방지). membership.(user_id, tenant_id) 는 유일하므로 행 중복 없음. {@link
   * #countByTenant} 와 동일 조인을 사용해 count 와 page 가 일치한다.
   */
  public List<UserResponse> findAllPaginated(Long tenantId, String search, int page, int size) {
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.KIND)
        .from(USER)
        .join(MEMBERSHIP)
        .on(USER.ID.eq(MEMBERSHIP.USER_ID))
        .where(tenantSearchCondition(tenantId, search))
        .orderBy(USER.ID.asc())
        .limit(size)
        .offset(page * size)
        .fetch(this::mapToUserResponse);
  }

  /** active 테넌트 멤버 수(설정 > 사용자 관리 페이지네이션용). */
  public long countByTenant(Long tenantId, String search) {
    return dsl.select(count())
        .from(USER)
        .join(MEMBERSHIP)
        .on(USER.ID.eq(MEMBERSHIP.USER_ID))
        .where(tenantSearchCondition(tenantId, search))
        .fetchOne(0, Long.class);
  }

  /** 테넌트 멤버십 + (선택) 검색어 조건 — 목록/카운트 쿼리 공용. 구성원 관리는 사람만 노출(AGENT 는 별도 화면). */
  private Condition tenantSearchCondition(Long tenantId, String search) {
    Condition condition =
        MEMBERSHIP.TENANT_ID.eq(tenantId).and(USER.KIND.eq(com.workplace.user.dto.UserKind.HUMAN));
    if (search != null && !search.isBlank()) {
      String pattern = LikePatternUtils.containsPattern(search);
      condition =
          condition.and(
              USER.USERNAME
                  .likeIgnoreCase(pattern, '\\')
                  .or(USER.NAME.likeIgnoreCase(pattern, '\\'))
                  .or(USER.EMAIL.likeIgnoreCase(pattern, '\\')));
    }
    return condition;
  }

  /** 전역 사용자 수(테넌트 무관). 가입 부트스트랩("첫 사용자") 판정 등 시스템 전역 집계에만 사용. */
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

  /** userId 목록 → name 맵(개인 프로젝트 소유자 폴백용). */
  public java.util.Map<Long, String> findNamesByIds(java.util.Collection<Long> ids) {
    java.util.Map<Long, String> result = new java.util.LinkedHashMap<>();
    if (ids.isEmpty()) return result;
    dsl.select(USER.ID, USER.NAME)
        .from(USER)
        .where(USER.ID.in(ids))
        .fetch()
        .forEach(r -> result.put(r.get(USER.ID), r.get(USER.NAME)));
    return result;
  }
}
