package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.*;
import static org.jooq.impl.DSL.field;

import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class RefreshTokenRepository {

  private static final Field<UUID> FAMILY_ID = field("family_id", UUID.class);

  private final DSLContext dsl;

  /** 토큰 재사용/grace 판단에 필요한 정보. familyId 는 이 토큰이 속한 family. */
  public record RevocationInfo(boolean revoked, LocalDateTime revokedAt, UUID familyId) {}

  /**
   * refresh 토큰 해시를 저장한다. jti(#686 수정)로 사실상 충돌이 없어졌지만, 방어적으로 token_hash 유니크 충돌 시에도 예외 대신
   * 무시(idempotent)하도록 처리한다 — 저장이 스킵돼도 동일 해시가 이미 존재한다는 뜻이므로 로그인 자체는 실패하지 않아야 한다.
   */
  public void save(Long userId, String tokenHash, LocalDateTime expiresAt, UUID familyId) {
    dsl.insertInto(REFRESH_TOKEN)
        .set(REFRESH_TOKEN.USER_ID, userId)
        .set(REFRESH_TOKEN.TOKEN_HASH, tokenHash)
        .set(REFRESH_TOKEN.EXPIRES_AT, expiresAt)
        .set(FAMILY_ID, familyId)
        .onConflictDoNothing()
        .execute();
  }

  public boolean existsValidToken(String tokenHash) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(REFRESH_TOKEN)
            .where(REFRESH_TOKEN.TOKEN_HASH.eq(tokenHash))
            .and(REFRESH_TOKEN.REVOKED.eq(false))
            .and(REFRESH_TOKEN.EXPIRES_AT.gt(LocalDateTime.now())));
  }

  public boolean isTokenRevoked(String tokenHash) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(REFRESH_TOKEN)
            .where(REFRESH_TOKEN.TOKEN_HASH.eq(tokenHash))
            .and(REFRESH_TOKEN.REVOKED.eq(true)));
  }

  public Optional<UUID> findFamilyIdByTokenHash(String tokenHash) {
    return dsl.select(FAMILY_ID)
        .from(REFRESH_TOKEN)
        .where(REFRESH_TOKEN.TOKEN_HASH.eq(tokenHash))
        .fetchOptional(FAMILY_ID);
  }

  /**
   * 토큰 해시의 폐기 상태·시각·family를 한 번에 조회한다(#grace-period). 존재하지 않는 해시면 empty — 호출부는 "폐기되었거나 만료된 토큰" 으로
   * 처리한다.
   */
  public Optional<RevocationInfo> findRevocationInfo(String tokenHash) {
    return dsl.select(REFRESH_TOKEN.REVOKED, REFRESH_TOKEN.REVOKED_AT, FAMILY_ID)
        .from(REFRESH_TOKEN)
        .where(REFRESH_TOKEN.TOKEN_HASH.eq(tokenHash))
        .fetchOptional(
            r ->
                new RevocationInfo(
                    r.get(REFRESH_TOKEN.REVOKED),
                    r.get(REFRESH_TOKEN.REVOKED_AT),
                    r.get(FAMILY_ID)));
  }

  /** family 안에 아직 살아있는(폐기되지 않고 만료되지 않은) 토큰이 있는지 — grace period 적용의 필수 조건(#grace-period). */
  public boolean existsLiveTokenInFamily(UUID familyId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(REFRESH_TOKEN)
            .where(FAMILY_ID.eq(familyId))
            .and(REFRESH_TOKEN.REVOKED.eq(false))
            .and(REFRESH_TOKEN.EXPIRES_AT.gt(LocalDateTime.now())));
  }

  public void revokeByTokenHash(String tokenHash) {
    dsl.update(REFRESH_TOKEN)
        .set(REFRESH_TOKEN.REVOKED, true)
        .set(REFRESH_TOKEN.REVOKED_AT, LocalDateTime.now())
        .where(REFRESH_TOKEN.TOKEN_HASH.eq(tokenHash))
        .execute();
  }

  public void revokeByFamilyId(UUID familyId) {
    dsl.update(REFRESH_TOKEN)
        .set(REFRESH_TOKEN.REVOKED, true)
        .set(REFRESH_TOKEN.REVOKED_AT, LocalDateTime.now())
        .where(FAMILY_ID.eq(familyId))
        .and(REFRESH_TOKEN.REVOKED.eq(false))
        .execute();
  }

  public void revokeAllByUserId(Long userId) {
    dsl.update(REFRESH_TOKEN)
        .set(REFRESH_TOKEN.REVOKED, true)
        .set(REFRESH_TOKEN.REVOKED_AT, LocalDateTime.now())
        .where(REFRESH_TOKEN.USER_ID.eq(userId))
        .and(REFRESH_TOKEN.REVOKED.eq(false))
        .execute();
  }

  public int deleteExpiredTokens() {
    return dsl.deleteFrom(REFRESH_TOKEN)
        .where(
            REFRESH_TOKEN
                .EXPIRES_AT
                .lt(LocalDateTime.now())
                .or(
                    REFRESH_TOKEN
                        .REVOKED
                        .eq(true)
                        .and(REFRESH_TOKEN.CREATED_AT.lt(LocalDateTime.now().minusDays(7)))))
        .execute();
  }
}
