package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.AGENT_API_KEY;

import com.workplace.auth.dto.AgentApiKeyResponse;
import com.workplace.auth.dto.ManagedKeyChain;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * Phase 5a — agent_api_key 테이블 jOOQ 리포지토리. 평문 키는 절대 저장/조회하지 않으며 SHA-256 hex 만 다룬다. revoked_at IS
 * NULL 조건으로 인증 hot path 가 좁혀진다.
 *
 * <p>WP-1253: 활성 키 = 회수되지 않았고 만료 시각이 없거나 아직 오지 않은 키({@link #activeAt}). 관리자 발급 키는 만료가 없고, Works 가
 * 자동 발급한 managed 키만 만료가 있다. 비교 기준 시각은 Java 쪽에서 넘긴다 — DB {@code now()} 는 트랜잭션 시작 시각이라 같은 트랜잭션에서 방금
 * 만료시킨 키가 활성으로 세어질 수 있다.
 */
@Repository
@RequiredArgsConstructor
public class AgentApiKeyRepository {

  private final DSLContext dsl;

  /** Record → API 응답 DTO 변환 (created_at/last_used_at/revoked_at 은 Instant 로 변환). */
  private AgentApiKeyResponse mapToResponse(Record r) {
    OffsetDateTime created = r.get(AGENT_API_KEY.CREATED_AT);
    OffsetDateTime lastUsed = r.get(AGENT_API_KEY.LAST_USED_AT);
    OffsetDateTime revoked = r.get(AGENT_API_KEY.REVOKED_AT);
    OffsetDateTime expires = r.get(AGENT_API_KEY.EXPIRES_AT);
    return new AgentApiKeyResponse(
        r.get(AGENT_API_KEY.ID),
        r.get(AGENT_API_KEY.USER_ID),
        r.get(AGENT_API_KEY.KEY_PREFIX),
        r.get(AGENT_API_KEY.LABEL),
        r.get(AGENT_API_KEY.CREATED_BY),
        created != null ? created.toInstant() : null,
        lastUsed != null ? lastUsed.toInstant() : null,
        revoked != null ? revoked.toInstant() : null,
        Boolean.TRUE.equals(r.get(AGENT_API_KEY.MANAGED)),
        expires != null ? expires.toInstant() : null);
  }

  /**
   * 활성 키 조건 — 회수되지 않았고(revoked_at NULL) 만료가 없거나 {@code now} 뒤에 만료되는 키(WP-1253). 인증·목록의 「마지막 키 사용
   * 시각」(UserRepository)·정리 유예 줄이기가 같은 조건을 쓴다.
   */
  public static Condition activeAt(OffsetDateTime now) {
    return AGENT_API_KEY
        .REVOKED_AT
        .isNull()
        .and(AGENT_API_KEY.EXPIRES_AT.isNull().or(AGENT_API_KEY.EXPIRES_AT.gt(now)));
  }

  /** 키 삽입. created_at 은 DB default(now()). 반환은 신규 키 id. */
  public Long insert(Long userId, String keyPrefix, String keyHash, String label, Long createdBy) {
    return dsl.insertInto(AGENT_API_KEY)
        .set(AGENT_API_KEY.USER_ID, userId)
        .set(AGENT_API_KEY.KEY_PREFIX, keyPrefix)
        .set(AGENT_API_KEY.KEY_HASH, keyHash)
        .set(AGENT_API_KEY.LABEL, label)
        .set(AGENT_API_KEY.CREATED_BY, createdBy)
        .returning(AGENT_API_KEY.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 지금 워크스페이스에서 보이는 키 조건(WP-1253) — 관리자 발급 키(워크스페이스에 묶이지 않음)와 이 워크스페이스가 자동 발급한 managed 키. 다른
   * 워크스페이스의 managed 키는 그쪽 Pod 의 키라 이 워크스페이스 관리자에게 보이거나 회수되지 않는다. 이 테이블은 RLS 가 없어 조건으로 가른다.
   */
  private static Condition visibleIn(long currentTenantId) {
    return AGENT_API_KEY.MANAGED.isFalse().or(AGENT_API_KEY.TENANT_ID.eq(currentTenantId));
  }

  /** 특정 AGENT 의 키 목록 (회수된 것 포함, 다른 워크스페이스의 managed 키 제외). 최근 생성 순. */
  public List<AgentApiKeyResponse> findByUser(Long userId, long currentTenantId) {
    return dsl.selectFrom(AGENT_API_KEY)
        .where(AGENT_API_KEY.USER_ID.eq(userId))
        .and(visibleIn(currentTenantId))
        .orderBy(AGENT_API_KEY.CREATED_AT.desc())
        .fetch(this::mapToResponse);
  }

  /**
   * 쓸 수 있는(활성) 관리자 발급 키 수 — 발급 상한 판정용(WP-818). Works 자동 발급(managed) 키는 세지 않는다(WP-1253) — 회전 주기가 이미
   * AI·워크스페이스마다 두세 개로 묶고, 관리자 상한이 자동 발급을 막아 Works 가 띄운 AI 가 키 없이 멈추면 안 된다.
   */
  public int countActiveAdmin(Long userId) {
    return dsl.fetchCount(
        AGENT_API_KEY,
        AGENT_API_KEY
            .USER_ID
            .eq(userId)
            .and(AGENT_API_KEY.MANAGED.isFalse())
            .and(activeAt(OffsetDateTime.now())));
  }

  /**
   * Works 자동 발급(managed) 키 삽입(WP-1253) — 발급한 사람이 없어 created_by 는 NULL. 반환은 신규 키 id.
   *
   * @param tenantId 발급한 워크스페이스 — managed 키 사슬은 (AI, 워크스페이스)마다 따로다
   * @param rotationGeneration 이 키가 맞춰진 실행 설정 generation(교체면 올린 값), 모르면 null
   */
  public Long insertManaged(
      Long userId,
      long tenantId,
      String keyPrefix,
      String keyHash,
      String label,
      OffsetDateTime expiresAt,
      Long rotationGeneration) {
    return dsl.insertInto(AGENT_API_KEY)
        .set(AGENT_API_KEY.USER_ID, userId)
        .set(AGENT_API_KEY.TENANT_ID, tenantId)
        .set(AGENT_API_KEY.KEY_PREFIX, keyPrefix)
        .set(AGENT_API_KEY.KEY_HASH, keyHash)
        .set(AGENT_API_KEY.LABEL, label)
        .set(AGENT_API_KEY.MANAGED, true)
        .set(AGENT_API_KEY.EXPIRES_AT, expiresAt)
        .set(AGENT_API_KEY.ROTATION_GENERATION, rotationGeneration)
        .returning(AGENT_API_KEY.ID)
        .fetchOne()
        .getId();
  }

  /** 이 워크스페이스의 managed 키 조건(WP-1253) — 다른 워크스페이스의 키 사슬에 닿지 않게 모든 managed 조작이 이 조건을 쓴다. */
  private static Condition managedIn(long tenantId) {
    return AGENT_API_KEY.MANAGED.isTrue().and(AGENT_API_KEY.TENANT_ID.eq(tenantId));
  }

  private static ManagedKeyChain.Key toManagedKey(Record r) {
    return new ManagedKeyChain.Key(
        r.get(AGENT_API_KEY.ID),
        r.get(AGENT_API_KEY.EXPIRES_AT),
        r.get(AGENT_API_KEY.ROTATION_GENERATION),
        r.get(AGENT_API_KEY.RETIRING_AT));
  }

  /** 이 AI 의 이 워크스페이스 활성 managed 키 사슬(WP-1253) — {@link #findActiveManagedByUsers} 의 한 AI 판. */
  public ManagedKeyChain findActiveManaged(long userId, long tenantId) {
    return findActiveManagedByUsers(List.of(userId), tenantId)
        .getOrDefault(userId, ManagedKeyChain.EMPTY);
  }

  /**
   * 여러 AI 의 이 워크스페이스 활성 managed 키 사슬을 한 번에 — AI id → 사슬(오래된 순, 키가 없는 AI 는 빠진다). desired·observed 가
   * AI 마다 따로 조회하지 않게 한다(WP-1253).
   */
  public Map<Long, ManagedKeyChain> findActiveManagedByUsers(
      Collection<Long> userIds, long tenantId) {
    if (userIds.isEmpty()) return Map.of();
    Map<Long, List<ManagedKeyChain.Key>> keys = new HashMap<>();
    dsl.select(
            AGENT_API_KEY.USER_ID,
            AGENT_API_KEY.ID,
            AGENT_API_KEY.EXPIRES_AT,
            AGENT_API_KEY.ROTATION_GENERATION,
            AGENT_API_KEY.RETIRING_AT)
        .from(AGENT_API_KEY)
        .where(AGENT_API_KEY.USER_ID.in(userIds))
        .and(managedIn(tenantId))
        .and(activeAt(OffsetDateTime.now()))
        .orderBy(AGENT_API_KEY.USER_ID, AGENT_API_KEY.ID)
        .forEach(
            r ->
                keys.computeIfAbsent(r.get(AGENT_API_KEY.USER_ID), k -> new ArrayList<>())
                    .add(toManagedKey(r)));
    Map<Long, ManagedKeyChain> out = new HashMap<>();
    keys.forEach((userId, list) -> out.put(userId, new ManagedKeyChain(list)));
    return out;
  }

  /**
   * 이 AI 에 이 워크스페이스 managed 키가 한 번이라도 있었는지(회수·만료 포함, WP-1253) — 활성 키가 없는데 있었다면 떠 있는 Pod 의 키가 이미 죽은
   * 것이다.
   */
  public boolean existsManaged(long userId, long tenantId) {
    return dsl.fetchExists(
        AGENT_API_KEY, AGENT_API_KEY.USER_ID.eq(userId).and(managedIn(tenantId)));
  }

  /**
   * 여러 AI 의 이 워크스페이스 활성 managed 키 만료를 {@code until} 로 당긴다(WP-1253 — 끄기·삭제·교체 확인 뒤 정리 유예). {@code
   * keepKeyIds} 는 남길 키(AI 마다 현재 키)다 — 키 id 는 한 AI 에만 속하므로 한 목록으로 넘겨도 된다. 이미 그보다 먼저 만료되는 키는 건드리지 않아
   * 늦추는 일이 없다 — 관찰 보고가 60초마다 와도 만료가 계속 밀리지 않는다. 관리자 발급 키·다른 워크스페이스의 managed 키는 건드리지 않는다.
   *
   * <p>줄이는 키에는 정리 유예에 들었다는 표시(retiring_at = 지금)를 함께 남긴다(WP-1263) — 「지금 쓰는 키」 판정({@link
   * ManagedKeyChain#live})이 만료 시각을 견줘 짐작하지 않게. 이미 표시가 있으면 처음 시각을 지킨다.
   *
   * @return 줄인 키 수
   */
  public int shortenManaged(
      Collection<Long> userIds, long tenantId, OffsetDateTime until, Collection<Long> keepKeyIds) {
    if (userIds.isEmpty()) return 0;
    return dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.EXPIRES_AT, until)
        .set(
            AGENT_API_KEY.RETIRING_AT,
            DSL.coalesce(AGENT_API_KEY.RETIRING_AT, DSL.val(OffsetDateTime.now())))
        .where(AGENT_API_KEY.USER_ID.in(userIds))
        .and(keepKeyIds.isEmpty() ? DSL.noCondition() : AGENT_API_KEY.ID.notIn(keepKeyIds))
        .and(managedIn(tenantId))
        // 활성 조건을 until 기준으로 — 이미 until 전에 만료되는 키는 고르지 않는다(늦추지 않음).
        .and(activeAt(until))
        .execute();
  }

  /** 한 AI 의 이 워크스페이스 활성 managed 키를 모두 {@code until} 로 당긴다 — {@link #shortenManaged} 의 한 AI 판. */
  public int shortenManaged(long userId, long tenantId, OffsetDateTime until) {
    return shortenManaged(List.of(userId), tenantId, until, Collections.emptyList());
  }

  /**
   * 이 워크스페이스의 managed 키 하나를 바로 만료·회수한다(WP-1253 — 전달되지 않은 재발급 전 키 버리기). 만료 시각과 함께 회수 시각도 남겨 활성 키 부분
   * 인덱스·관리자 목록에서 회수된 키로 보이게 한다. 이미 회수된 키는 그대로다.
   *
   * @return 바꾼 키 수(0 또는 1)
   */
  public int expireManagedNow(long keyId, long tenantId, OffsetDateTime now) {
    return dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.EXPIRES_AT, now)
        .set(AGENT_API_KEY.REVOKED_AT, now)
        .where(AGENT_API_KEY.ID.eq(keyId))
        .and(managedIn(tenantId))
        .and(AGENT_API_KEY.REVOKED_AT.isNull())
        .execute();
  }

  /**
   * 만료가 {@code before} 보다 앞선 managed 키에 회수 시각을 남긴다(WP-1253 — 정기 정리). 만료된 키는 이미 인증되지 않지만, 회수 시각을 채워
   * 활성 키 부분 인덱스(revoked_at IS NULL)에서 빠지게 한다. 모든 워크스페이스가 대상이다(이 테이블은 RLS 가 없다).
   *
   * @return 회수 시각을 남긴 키 수
   */
  public int revokeExpiredManaged(OffsetDateTime before) {
    return dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.REVOKED_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.MANAGED.isTrue())
        .and(AGENT_API_KEY.REVOKED_AT.isNull())
        .and(AGENT_API_KEY.EXPIRES_AT.lt(before))
        .execute();
  }

  /**
   * 에이전트 단위 발급 잠금(트랜잭션 끝까지) — 동시 발급이 함께 상한을 넘지 않게 센 뒤 넣기까지를 차례로 세운다(WP-818). 개인 PAT 발급과 같은 잠금 클래스다.
   */
  public void lockIssue(Long userId) {
    dsl.execute(
        "SELECT pg_advisory_xact_lock(?, ?)",
        UserApiTokenRepository.ISSUE_LOCK_CLASS,
        userId.intValue());
  }

  /** 인증 hot path — hash 단일 매칭 + 활성(회수 안 됨·만료 안 됨, WP-1253). */
  public Optional<ActiveKey> findActiveByHash(String hash) {
    return dsl.select(AGENT_API_KEY.ID, AGENT_API_KEY.USER_ID, AGENT_API_KEY.TENANT_ID)
        .from(AGENT_API_KEY)
        .where(AGENT_API_KEY.KEY_HASH.eq(hash).and(activeAt(OffsetDateTime.now())))
        .fetchOptional(
            r ->
                new ActiveKey(
                    r.get(AGENT_API_KEY.ID),
                    r.get(AGENT_API_KEY.USER_ID),
                    r.get(AGENT_API_KEY.TENANT_ID)));
  }

  /**
   * 인증에 성공한 활성 키 정보 (필터에서 user 조회와 last_used_at 갱신에 사용).
   *
   * @param tenantId 키가 묶인 워크스페이스(Works 자동 발급 키만, 관리자 발급 키는 null) — 있으면 요청은 그 워크스페이스로만 들어간다(WP-1253)
   */
  public record ActiveKey(Long id, Long userId, Long tenantId) {
    /** 워크스페이스에 묶이지 않은 키(관리자 발급) — 기존 생성자 호환. */
    public ActiveKey(Long id, Long userId) {
      this(id, userId, null);
    }
  }

  /** 인증 성공 시 last_used_at 을 now() 로 갱신. 단순 update — async/throttle 미적용. */
  public void touchLastUsed(Long keyId) {
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.LAST_USED_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.ID.eq(keyId))
        .execute();
  }

  /** 활성 키만 회수 (이미 회수된 키·다른 워크스페이스의 managed 키는 영향 없음). 영향 받은 row 수 반환. */
  public int revoke(Long keyId, long currentTenantId) {
    return dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.REVOKED_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.ID.eq(keyId).and(AGENT_API_KEY.REVOKED_AT.isNull()))
        .and(visibleIn(currentTenantId))
        .execute();
  }

  /** 이 AGENT 의 활성 키를 모두 회수한다(WP-705 — 삭제 대신 사용 중지). 영향 받은 row 수 반환. */
  public int revokeAllActive(long userId) {
    return dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.REVOKED_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.USER_ID.eq(userId).and(AGENT_API_KEY.REVOKED_AT.isNull()))
        .execute();
  }

  /** 단건 조회 (관리 화면용) — 다른 워크스페이스의 managed 키는 없는 것과 같다(WP-1253). */
  public Optional<AgentApiKeyResponse> findById(Long id, long currentTenantId) {
    return dsl.selectFrom(AGENT_API_KEY)
        .where(AGENT_API_KEY.ID.eq(id))
        .and(visibleIn(currentTenantId))
        .fetchOptional(this::mapToResponse);
  }
}
