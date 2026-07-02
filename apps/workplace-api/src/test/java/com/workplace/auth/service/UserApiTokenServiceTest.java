package com.workplace.auth.service;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_API_TOKEN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.dto.UserApiTokenIssueResponse;
import com.workplace.auth.dto.UserApiTokenResponse;
import com.workplace.auth.exception.ActiveTenantRequiredException;
import com.workplace.auth.exception.UserTokenNotFoundException;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 사용자 PAT 발급/조회/회수 서비스 테스트. 평문 1회 노출·해시 저장·테넌트 바인딩을 검증한다. */
@Transactional
class UserApiTokenServiceTest extends IntegrationTestBase {

  @Autowired private UserApiTokenService service;
  @Autowired private UserApiTokenRepository repo;
  @Autowired private DSLContext dsl;

  private Long userId;
  private Long otherUserId;

  @BeforeEach
  void seed() {
    long n = System.nanoTime();
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "pat-user-" + n)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "PatUser")
            .set(USER.EMAIL, "pat-user-" + n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    otherUserId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "pat-other-" + n)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "PatOther")
            .set(USER.EMAIL, "pat-other-" + n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  private String sha256Hex(String plaintext) throws Exception {
    MessageDigest md = MessageDigest.getInstance("SHA-256");
    return HexFormat.of().formatHex(md.digest(plaintext.getBytes(StandardCharsets.UTF_8)));
  }

  @Test
  void issue_returns_swp_plaintext_once_and_stores_hash_only() throws Exception {
    UserApiTokenIssueResponse res = service.issue(userId, new IssueUserTokenRequest("내 노트북", null));
    assertThat(res.plaintextToken()).startsWith("swp_");
    assertThat(res.tokenPrefix()).isEqualTo(res.plaintextToken().substring(0, 12));
    // DB 에는 평문이 없고 SHA-256 hex(64자)만 저장된다.
    String hash =
        dsl.select(USER_API_TOKEN.TOKEN_HASH)
            .from(USER_API_TOKEN)
            .where(USER_API_TOKEN.ID.eq(res.id()))
            .fetchOne()
            .value1();
    assertThat(hash).hasSize(64).isNotEqualTo(res.plaintextToken());
    assertThat(hash).isEqualTo(sha256Hex(res.plaintextToken()));
  }

  @Test
  void issue_binds_active_tenant() throws Exception {
    UserApiTokenIssueResponse res = service.issue(userId, new IssueUserTokenRequest("t", null));
    assertThat(repo.findActiveByHash(sha256Hex(res.plaintextToken())).orElseThrow().tenantId())
        .isEqualTo(defaultTenantId());
  }

  @Test
  void issue_without_active_tenant_throws() {
    TenantContext.clear();
    assertThatThrownBy(() -> service.issue(userId, new IssueUserTokenRequest("t", null)))
        .isInstanceOf(ActiveTenantRequiredException.class);
  }

  @Test
  void list_excludes_hash_and_orders_desc() {
    UserApiTokenIssueResponse r1 = service.issue(userId, new IssueUserTokenRequest("first", null));
    UserApiTokenIssueResponse r2 = service.issue(userId, new IssueUserTokenRequest("second", null));
    List<UserApiTokenResponse> list = service.list(userId);
    assertThat(list).hasSize(2);
    // 최근 생성 순 (desc) — r2 가 먼저.
    assertThat(list.get(0).id()).isEqualTo(r2.id());
    assertThat(list.get(1).id()).isEqualTo(r1.id());
    assertThat(list).allSatisfy(t -> assertThat(t.tokenPrefix()).startsWith("swp_"));
  }

  @Test
  void revoke_other_users_token_is_404() {
    UserApiTokenIssueResponse res = service.issue(userId, new IssueUserTokenRequest("t", null));
    assertThatThrownBy(() -> service.revoke(otherUserId, res.id()))
        .isInstanceOf(UserTokenNotFoundException.class);
  }

  @Test
  void revoked_token_not_found_by_hash() throws Exception {
    UserApiTokenIssueResponse res = service.issue(userId, new IssueUserTokenRequest("t", null));
    service.revoke(userId, res.id());
    assertThat(repo.findActiveByHash(sha256Hex(res.plaintextToken()))).isEmpty();
  }

  @Test
  void expired_token_not_found_by_hash() throws Exception {
    UserApiTokenIssueResponse res =
        service.issue(userId, new IssueUserTokenRequest("t", Instant.now().minusSeconds(60)));
    assertThat(repo.findActiveByHash(sha256Hex(res.plaintextToken()))).isEmpty();
  }
}
