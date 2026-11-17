package com.workplace.auth.oauth.repository;

import static com.workplace.jooq.Tables.OAUTH_AUTHORIZATION_CODE;

import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * oauth_authorization_code 테이블 jOOQ 리포지토리(WP-1685). 인가 코드는 1회용·단기(10분)이며 평문이 아닌 SHA-256 hex 만 저장한다.
 */
@Repository
@RequiredArgsConstructor
public class OAuthCodeRepository {

  private final DSLContext dsl;

  /** 코드 한 건 — 토큰 교환 시 redirect_uri·PKCE·resource 를 대조하는 데 쓴다. */
  public record CodeRow(
      long id,
      long connectionId,
      String redirectUri,
      String codeChallenge,
      String resource,
      OffsetDateTime expiresAt,
      OffsetDateTime usedAt) {}

  /** 코드 발급 저장. created_at 은 DB default(now()). */
  public void insert(
      String codeHash,
      long connectionId,
      String redirectUri,
      String codeChallenge,
      String resource,
      OffsetDateTime expiresAt) {
    dsl.insertInto(OAUTH_AUTHORIZATION_CODE)
        .set(OAUTH_AUTHORIZATION_CODE.CODE_HASH, codeHash)
        .set(OAUTH_AUTHORIZATION_CODE.CONNECTION_ID, connectionId)
        .set(OAUTH_AUTHORIZATION_CODE.REDIRECT_URI, redirectUri)
        .set(OAUTH_AUTHORIZATION_CODE.CODE_CHALLENGE, codeChallenge)
        .set(OAUTH_AUTHORIZATION_CODE.RESOURCE, resource)
        .set(OAUTH_AUTHORIZATION_CODE.EXPIRES_AT, expiresAt)
        .execute();
  }

  /** 해시로 조회(사용·만료 여부와 무관 — 판정은 서비스가 한다. 재사용 감지에 used 행도 필요). */
  public Optional<CodeRow> findByHash(String codeHash) {
    return dsl.selectFrom(OAUTH_AUTHORIZATION_CODE)
        .where(OAUTH_AUTHORIZATION_CODE.CODE_HASH.eq(codeHash))
        .fetchOptional(
            r ->
                new CodeRow(
                    r.getId(),
                    r.getConnectionId(),
                    r.getRedirectUri(),
                    r.getCodeChallenge(),
                    r.getResource(),
                    r.getExpiresAt(),
                    r.getUsedAt()));
  }

  /** 원자적 사용 표시 — {@code used_at IS NULL} 일 때만 갱신하므로 동시 교환 중 정확히 하나만 true 를 받는다. */
  public boolean markUsed(long id) {
    return dsl.update(OAUTH_AUTHORIZATION_CODE)
            .set(OAUTH_AUTHORIZATION_CODE.USED_AT, OffsetDateTime.now())
            .where(OAUTH_AUTHORIZATION_CODE.ID.eq(id))
            .and(OAUTH_AUTHORIZATION_CODE.USED_AT.isNull())
            .execute()
        > 0;
  }

  /** 만료 시각이 {@code cutoff} 이전인 코드를 지운다(정리 작업용). 반환은 지운 행 수. */
  public int deleteExpiredBefore(OffsetDateTime cutoff) {
    return dsl.deleteFrom(OAUTH_AUTHORIZATION_CODE)
        .where(OAUTH_AUTHORIZATION_CODE.EXPIRES_AT.lt(cutoff))
        .execute();
  }
}
