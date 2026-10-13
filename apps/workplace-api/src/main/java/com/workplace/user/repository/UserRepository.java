package com.workplace.user.repository;

import static com.workplace.jooq.Tables.*;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.lower;
import static org.jooq.impl.DSL.trueCondition;
import static org.jooq.impl.DSL.val;

import com.workplace.global.util.LikePatternUtils;
import com.workplace.user.dto.AgentResponse;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
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

  /**
   * WP-48: username 대소문자 무시 조회 — SSO 최초 연결 매칭용. username 유니크 제약은 대소문자를 구분하므로 대소문자만 다른 두 계정이 공존할 수
   * 있다. 호출자가 그 경우를 충돌로 처리하도록 최대 2건을 돌려준다.
   */
  public List<Long> findIdsByUsernameIgnoreCase(String username) {
    return dsl.select(USER.ID)
        .from(USER)
        .where(lower(USER.USERNAME).eq(username.toLowerCase(Locale.ROOT)))
        .limit(2)
        .fetch(USER.ID);
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
  public List<AgentResponse> findAgents(Long tenantId, boolean includePersonal) {
    // 개인 비서 소유자(사람) 이름을 얻기 위한 self-join: owner.personal_assistant_agent_id = agent.id.
    com.workplace.jooq.tables.User owner = USER.as("owner");
    Condition where = MEMBERSHIP.TENANT_ID.eq(tenantId).and(USER.KIND.eq(UserKind.AGENT));
    if (!includePersonal) {
      // startsWith 는 LIKE 와일드카드를 이스케이프하므로 `__` 가 임의문자로 해석되지 않는다.
      where = where.and(USER.USERNAME.startsWith(AgentUsernames.PERSONAL_ASSISTANT_PREFIX).not());
    }
    // WP-371: 에이전트별 "마지막 키 사용 시각" = 폐기되지 않은 키의 last_used_at 최댓값(키 없으면 null). 목록에 나온 에이전트 행마다
    // 상관 서브쿼리로 계산한다 — 전 테넌트 키를 집계하는 파생 테이블과 달리 대상 에이전트 키만 idx_agent_api_key_user(V14)로 읽는다.
    Field<OffsetDateTime> keyLastUsed =
        DSL.select(DSL.max(AGENT_API_KEY.LAST_USED_AT))
            .from(AGENT_API_KEY)
            .where(AGENT_API_KEY.USER_ID.eq(USER.ID))
            .and(AGENT_API_KEY.REVOKED_AT.isNull())
            .asField("last_key_used_at");
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.EMAIL,
            USER.NAME,
            USER.IS_ACTIVE,
            USER.CREATED_AT,
            USER.AGENT_RUNTIME,
            keyLastUsed,
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
              boolean isPersonal = AgentUsernames.isPersonalAssistant(username);
              String type =
                  isPersonal
                      ? AgentResponse.TYPE_PERSONAL
                      : (wsAgentId != null
                          ? AgentResponse.TYPE_WORKSPACE
                          : AgentResponse.TYPE_REGULAR);
              return new AgentResponse(
                  r.get(USER.ID),
                  username,
                  r.get(USER.EMAIL),
                  r.get(USER.NAME),
                  Boolean.TRUE.equals(r.get(USER.IS_ACTIVE)),
                  r.get(USER.CREATED_AT),
                  type,
                  isPersonal ? ownerName : null,
                  r.get(USER.AGENT_RUNTIME),
                  r.get(keyLastUsed) != null ? r.get(keyLastUsed).toInstant() : null);
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

  /** WP-48: 비밀번호 보유 여부(SSO 전용 계정이면 false). */
  public boolean hasPassword(Long id) {
    return dsl.fetchExists(
        dsl.selectFrom(USER).where(USER.ID.eq(id)).and(USER.PASSWORD.isNotNull()));
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

  /**
   * 에이전트 실행 방식(INTERNAL|EXTERNAL) 변경 (WP-371). 호출 전 AGENT 여부·보호 대상(비서) 검증은 서비스가 한다. 값이 실제로 바뀐 경우에만
   * true — 대상이 없거나 이미 같은 값이면 false(별도 선조회 없이 한 문장으로 변경 여부를 판단한다).
   */
  public boolean updateAgentRuntime(Long id, String runtime) {
    return dsl.update(USER)
            .set(USER.AGENT_RUNTIME, runtime)
            .set(USER.UPDATED_AT, LocalDateTime.now())
            .where(USER.ID.eq(id))
            .and(USER.AGENT_RUNTIME.isDistinctFrom(runtime))
            .execute()
        > 0;
  }

  /** 해당 유저가 EXTERNAL 실행 방식의 AGENT 인지 (공통 비서 지정 가드용). 대상이 없으면 false. */
  public boolean isExternalAgent(Long id) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(USER)
            .where(USER.ID.eq(id))
            .and(USER.KIND.eq(UserKind.AGENT))
            .and(USER.AGENT_RUNTIME.eq(AgentRuntime.EXTERNAL)));
  }

  /**
   * 해당 에이전트가 서버 실행(AI Chat)이 필요한 비서인지 — 어떤 테넌트의 공통 비서이거나 개인 비서이면 true (WP-371). 이런 에이전트는 EXTERNAL 로
   * 둘 수 없다. 한 번의 쿼리로 세 조건을 OR 로 본다.
   *
   * <ul>
   *   <li>공통 비서: workspace_assistant 는 RLS 라 일반 쿼리로는 현재 테넌트 행만 보인다. 에이전트는 여러 테넌트에 속할 수 있으므로 RLS 를
   *       우회하는 SECURITY DEFINER 함수(V167 is_workspace_assistant_agent)로 전 테넌트를 확인한다.
   *   <li>개인 비서(연결됨): 누군가의 user.personal_assistant_agent_id 가 이 에이전트를 가리킨다.
   *   <li>개인 비서(해제됨): 개인 비서 해제(PersonalAssistantService.disable)는 포인터만 끊고 행(username 접두어 {@code
   *       __assistant_u})은 남긴다. 재등록 시 같은 행을 username 으로 찾아 다시 연결하므로, 포인터만 보면 해제 중에 EXTERNAL 로 바뀐 뒤
   *       외부 실행 개인 비서로 되살아날 수 있다 — 그래서 접두어도 함께 본다.
   * </ul>
   */
  public boolean isAssistantAgent(Long id) {
    Condition workspaceAssistant = DSL.condition("is_workspace_assistant_agent({0})", val(id));
    Condition linkedPersonal =
        DSL.exists(dsl.selectOne().from(USER).where(USER.PERSONAL_ASSISTANT_AGENT_ID.eq(id)));
    // startsWith 는 LIKE 와일드카드를 이스케이프하므로 `__` 가 임의문자로 해석되지 않는다.
    Condition personalByUsername =
        DSL.exists(
            dsl.selectOne()
                .from(USER)
                .where(USER.ID.eq(id))
                .and(USER.USERNAME.startsWith(AgentUsernames.PERSONAL_ASSISTANT_PREFIX)));
    return Boolean.TRUE.equals(
        dsl.fetchValue(DSL.field(workspaceAssistant.or(linkedPersonal).or(personalByUsername))));
  }

  /**
   * 에이전트 user 행을 {@code SELECT ... FOR UPDATE} 로 잠근다(WP-371) — {@code AgentRuntimePolicy.lock} 이 실행
   * 방식 변경과 공통 비서 지정을 직렬화하는 데 쓴다. 반드시 트랜잭션 안에서 호출해야 하며 락은 커밋/롤백까지 유지된다.
   */
  public void lockForUpdate(Long id) {
    dsl.select(USER.ID).from(USER).where(USER.ID.eq(id)).forUpdate().fetch();
  }

  /** 담당자 지정 처리용 사용자 정보를 한 번에 조회(활성 여부·AI 실행 방식 포함). 없는 id 는 빠진다. */
  public List<AssigneeInfo> findAssigneeInfos(Collection<Long> ids) {
    if (ids == null || ids.isEmpty()) return List.of();
    return dsl.select(
            USER.ID, USER.USERNAME, USER.NAME, USER.KIND, USER.IS_ACTIVE, USER.AGENT_RUNTIME)
        .from(USER)
        .where(USER.ID.in(ids))
        .fetch(
            r ->
                new AssigneeInfo(
                    r.get(USER.ID),
                    r.get(USER.USERNAME),
                    r.get(USER.NAME),
                    r.get(USER.KIND),
                    Boolean.TRUE.equals(r.get(USER.IS_ACTIVE)),
                    r.get(USER.AGENT_RUNTIME)));
  }

  /** 표시 이름(name)만 변경한다 — 개인 비서 이름 변경 등. email/username 은 보존. */
  public void updateName(Long id, String name) {
    dsl.update(USER)
        .set(USER.NAME, name)
        .set(USER.UPDATED_AT, LocalDateTime.now())
        .where(USER.ID.eq(id))
        .execute();
  }

  /** AI 추천 질문 사용 여부(WP-139). NULL(미설정)·없는 사용자는 켜짐으로 본다 — 기본 켜짐이 스펙. */
  public boolean isAiSuggestionsEnabled(long id) {
    Boolean v =
        dsl.select(USER.AI_SUGGESTIONS_ENABLED)
            .from(USER)
            .where(USER.ID.eq(id))
            .fetchOne(USER.AI_SUGGESTIONS_ENABLED);
    return v == null || v;
  }

  /** AI 추천 질문 사용 여부 저장(WP-139). */
  public void updateAiSuggestionsEnabled(long id, boolean enabled) {
    dsl.update(USER)
        .set(USER.AI_SUGGESTIONS_ENABLED, enabled)
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
        .set(USER.KIND, UserKind.AGENT)
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
        .set(USER.KIND, UserKind.AGENT)
        .setNull(USER.PASSWORD)
        .returning(USER.ID)
        .fetchOne(USER.ID);
  }

  /**
   * 사용자 목록을 active 테넌트로 스코프한다(설정 > 사용자 관리 / DM 수신자 검색 등 공용). user 는 전역 테이블이라 RLS 가 걸리지 않으므로
   * membership 조인으로 명시적으로 테넌트 멤버만 거른다(다른 테넌트 사용자 누출 방지). membership.(user_id, tenant_id) 는 유일하므로 행
   * 중복 없음. {@link #countByTenant} 와 동일 조인을 사용해 count 와 page 가 일치한다.
   *
   * @param kind {@link com.workplace.user.dto.UserKind#HUMAN}/{@link
   *     com.workplace.user.dto.UserKind#AGENT} 단일 필터 또는 {@link
   *     com.workplace.user.dto.UserKind#ALL_FILTER}(필터 없음). 호출부는 기본값을 HUMAN 으로 둬서(설정 > 사용자 관리) 기존
   *     동작을 유지하고, 에이전트를 포함해야 하는 화면(예: 새 메시지 받는사람 검색)만 명시적으로 AGENT/ALL 을 넘긴다.
   */
  public List<UserResponse> findAllPaginated(
      Long tenantId, String search, int page, int size, String kind) {
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
        .where(tenantSearchCondition(tenantId, search, kind))
        .orderBy(USER.ID.asc())
        .limit(size)
        .offset(page * size)
        .fetch(this::mapToUserResponse);
  }

  /** active 테넌트 멤버 수(사용자 목록 페이지네이션용). kind 의미는 {@link #findAllPaginated} 와 동일. */
  public long countByTenant(Long tenantId, String search, String kind) {
    return dsl.select(count())
        .from(USER)
        .join(MEMBERSHIP)
        .on(USER.ID.eq(MEMBERSHIP.USER_ID))
        .where(tenantSearchCondition(tenantId, search, kind))
        .fetchOne(0, Long.class);
  }

  /**
   * 테넌트 멤버십 + kind 필터 + (선택) 검색어 조건 — 목록/카운트 쿼리 공용. kind 가 {@link
   * com.workplace.user.dto.UserKind#ALL_FILTER}면 kind 조건 자체를 걸지 않아 HUMAN/AGENT 모두 노출한다(DM 수신자 검색
   * 등). 그 외 값은 해당 kind 로 좁힌다.
   */
  private Condition tenantSearchCondition(Long tenantId, String search, String kind) {
    Condition condition = MEMBERSHIP.TENANT_ID.eq(tenantId);
    if (!UserKind.ALL_FILTER.equals(kind)) {
      String effectiveKind = kind != null ? kind : UserKind.HUMAN;
      condition = condition.and(USER.KIND.eq(effectiveKind));
    }
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

  /** WP-48: 테넌트의 ACTIVE 구성원 중 비밀번호가 없는 활성 HUMAN 수 — SSO 끄기 전 확인 다이얼로그용. */
  public long countPasswordlessHumanMembers(Long tenantId) {
    return dsl.selectCount()
        .from(USER)
        .join(MEMBERSHIP)
        .on(MEMBERSHIP.USER_ID.eq(USER.ID))
        .where(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .and(MEMBERSHIP.STATUS.eq("ACTIVE"))
        .and(USER.PASSWORD.isNull())
        .and(USER.KIND.eq("HUMAN"))
        .and(USER.IS_ACTIVE.isTrue())
        .fetchOne(0, long.class);
  }
}
