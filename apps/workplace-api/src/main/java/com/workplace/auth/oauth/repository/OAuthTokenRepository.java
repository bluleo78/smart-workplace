package com.workplace.auth.oauth.repository;

import static com.workplace.jooq.Tables.OAUTH_CONNECTION;
import static com.workplace.jooq.Tables.OAUTH_TOKEN;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * oauth_token 테이블 jOOQ 리포지토리(WP-1685). 액세스(ACCESS)·리프레시(REFRESH) 토큰을 SHA-256 hex 로만 저장한다. 액세스 토큰
 * 조회는 인증 hot path — 활성 토큰 해시 부분 인덱스를 탄다.
 */
@Repository
@RequiredArgsConstructor
public class OAuthTokenRepository {

  /** kind — 액세스 토큰(swo_). */
  public static final String KIND_ACCESS = "ACCESS";

  /** kind — 리프레시 토큰(swr_). */
  public static final String KIND_REFRESH = "REFRESH";

  private final DSLContext dsl;

  /**
   * 인증에 성공한 활성 액세스 토큰 정보 — 필터가 user/tenant 로 인증 주체를 만든다. lastUsedAt 은 연결의 마지막 사용 시각으로, 필터가 갱신이 필요한지
   * (1분 간격) 미리 보고 불필요한 UPDATE 를 건너뛰는 데 쓴다.
   */
  public record ActiveAccess(
      long connectionId, long userId, long tenantId, OffsetDateTime lastUsedAt) {}

  /**
   * 새로 저장할 토큰 한 개 — kind 는 {@link #KIND_ACCESS}·{@link #KIND_REFRESH}, tokenPrefix 는 표시·로그용 앞부분.
   */
  public record NewToken(
      String kind, String tokenHash, String tokenPrefix, OffsetDateTime expiresAt) {}

  /** 리프레시 토큰 한 건 — 회전·재사용 감지 판정용(만료·사용·폐기 시각 포함). */
  public record RefreshRow(
      long id,
      long connectionId,
      String resource,
      OffsetDateTime expiresAt,
      OffsetDateTime usedAt,
      OffsetDateTime revokedAt) {}

  /**
   * 인증 hot path — 해시 매칭 + ACCESS + 미폐기 + 미만료 + 연결 미폐기. 연결이 폐기되면 남은 토큰도 즉시 거부된다(연결 폐기 때 토큰을 함께
   * 폐기하지만, 이 조인이 한 번 더 막는다).
   */
  public Optional<ActiveAccess> findActiveAccess(String tokenHash, OffsetDateTime now) {
    return dsl.select(
            OAUTH_TOKEN.CONNECTION_ID,
            OAUTH_CONNECTION.USER_ID,
            OAUTH_CONNECTION.TENANT_ID,
            OAUTH_CONNECTION.LAST_USED_AT)
        .from(OAUTH_TOKEN)
        .join(OAUTH_CONNECTION)
        .on(OAUTH_CONNECTION.ID.eq(OAUTH_TOKEN.CONNECTION_ID))
        .where(OAUTH_TOKEN.TOKEN_HASH.eq(tokenHash))
        .and(OAUTH_TOKEN.KIND.eq(KIND_ACCESS))
        .and(OAUTH_TOKEN.REVOKED_AT.isNull())
        .and(OAUTH_TOKEN.EXPIRES_AT.gt(now))
        .and(OAUTH_CONNECTION.REVOKED_AT.isNull())
        .fetchOptional(r -> new ActiveAccess(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /** 리프레시 토큰을 해시로 조회(사용·폐기된 행도 포함 — 재사용 감지에 필요). ACCESS 행은 돌려주지 않는다. */
  public Optional<RefreshRow> findRefresh(String tokenHash) {
    return dsl.selectFrom(OAUTH_TOKEN)
        .where(OAUTH_TOKEN.TOKEN_HASH.eq(tokenHash))
        .and(OAUTH_TOKEN.KIND.eq(KIND_REFRESH))
        .fetchOptional(
            r ->
                new RefreshRow(
                    r.getId(),
                    r.getConnectionId(),
                    r.getResource(),
                    r.getExpiresAt(),
                    r.getUsedAt(),
                    r.getRevokedAt()));
  }

  /**
   * 리프레시 회전 표시 — {@code used_at IS NULL AND revoked_at IS NULL} 일 때만 갱신하는 원자적 UPDATE 라 동시 갱신 중 정확히
   * 하나만 true. false 면 이미 쓰였거나 폐기된 것(재사용 시도).
   */
  public boolean markRefreshUsed(long id) {
    return dsl.update(OAUTH_TOKEN)
            .set(OAUTH_TOKEN.USED_AT, OffsetDateTime.now())
            .where(OAUTH_TOKEN.ID.eq(id))
            .and(OAUTH_TOKEN.KIND.eq(KIND_REFRESH))
            .and(OAUTH_TOKEN.USED_AT.isNull())
            .and(OAUTH_TOKEN.REVOKED_AT.isNull())
            .execute()
        > 0;
  }

  /** 토큰 한 개 저장. kind 는 'ACCESS'|'REFRESH'(DB CHECK 가 보장), tokenPrefix 는 표시·로그용 앞 12자. */
  public void insert(
      long connectionId,
      String kind,
      String tokenHash,
      String tokenPrefix,
      String resource,
      OffsetDateTime expiresAt) {
    insertAll(
        connectionId, resource, List.of(new NewToken(kind, tokenHash, tokenPrefix, expiresAt)));
  }

  /**
   * 같은 연결·resource 의 토큰 여러 개를 한 INSERT 문(다중 VALUES)으로 저장한다 — 토큰 발급이 access·refresh 한 벌을 DB 왕복 한 번에
   * 넣는다.
   */
  public void insertAll(long connectionId, String resource, List<NewToken> newTokens) {
    var insert =
        dsl.insertInto(
            OAUTH_TOKEN,
            OAUTH_TOKEN.CONNECTION_ID,
            OAUTH_TOKEN.KIND,
            OAUTH_TOKEN.TOKEN_HASH,
            OAUTH_TOKEN.TOKEN_PREFIX,
            OAUTH_TOKEN.RESOURCE,
            OAUTH_TOKEN.EXPIRES_AT);
    for (NewToken t : newTokens) {
      insert =
          insert.values(
              connectionId, t.kind(), t.tokenHash(), t.tokenPrefix(), resource, t.expiresAt());
    }
    insert.execute();
  }

  /** 연결의 살아 있는 토큰(ACCESS·REFRESH)을 모두 폐기한다 — 연결 해제·리프레시 재사용 감지 시. 반환은 이번에 폐기된 행 수. */
  public int revokeAllForConnection(long connectionId) {
    return dsl.update(OAUTH_TOKEN)
        .set(OAUTH_TOKEN.REVOKED_AT, OffsetDateTime.now())
        .where(OAUTH_TOKEN.CONNECTION_ID.eq(connectionId))
        .and(OAUTH_TOKEN.REVOKED_AT.isNull())
        .execute();
  }

  /** 만료 시각이 {@code cutoff} 이전인 토큰을 지운다(정리 작업용). 반환은 지운 행 수. */
  public int deleteExpiredBefore(OffsetDateTime cutoff) {
    return dsl.deleteFrom(OAUTH_TOKEN).where(OAUTH_TOKEN.EXPIRES_AT.lt(cutoff)).execute();
  }
}
