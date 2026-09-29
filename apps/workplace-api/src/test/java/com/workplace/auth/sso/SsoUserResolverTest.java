package com.workplace.auth.sso;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_EXTERNAL_IDENTITY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;

/** 클레임 → 사용자 결정. username 과만 매칭, 도메인 검증된 값만, 진입 검사 후 연결 저장, JIT 없음. */
@Transactional
class SsoUserResolverTest extends SsoIntegrationTestBase {

  private static final String TID = "11111111-2222-3333-4444-555555555555";

  @Autowired SsoUserResolver resolver;
  @Autowired DSLContext dsl;

  long ssoTenant;

  @BeforeEach
  void seed() {
    ssoTenant = SsoTestData.tenant(dsl, true);
  }

  private Jwt token(String oid, Map<String, Object> extra) {
    Map<String, Object> claims = new HashMap<>(Map.of("tid", TID, "oid", oid, "sub", "s"));
    claims.putAll(extra);
    return new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "RS256"), claims);
  }

  private long member(String username) {
    long id = SsoTestData.user(dsl, username, null);
    SsoTestData.member(dsl, id, ssoTenant);
    return id;
  }

  @Test
  void firstLink_byVerifiedEmail() {
    String email = SsoTestData.uniqueEmail("hong");
    long id = member(email);

    var r = resolver.resolve(token("oid-1", Map.of("email", email, "xms_edov", true)));

    assertThat(r.user().id()).isEqualTo(id);
    assertThat(r.newlyLinked()).isTrue();
    assertThat(dsl.fetchCount(USER_EXTERNAL_IDENTITY, USER_EXTERNAL_IDENTITY.USER_ID.eq(id))).isEqualTo(1);
  }

  @Test
  void firstLink_byUpn() {
    String upn = SsoTestData.uniqueEmail("kim");
    long id = member(upn);
    assertThat(resolver.resolve(token("oid-2", Map.of("upn", upn))).user().id()).isEqualTo(id);
  }

  @Test
  void matchesUsernameIgnoringCase() {
    String email = SsoTestData.uniqueEmail("park");
    long id = member(email.toUpperCase());
    assertThat(resolver.resolve(token("oid-3", Map.of("upn", email))).user().id()).isEqualTo(id);
  }

  @Test
  void relogin_usesLinkEvenIfClaimsChange() {
    String email = SsoTestData.uniqueEmail("lee");
    long id = member(email);
    resolver.resolve(token("oid-4", Map.of("upn", email)));

    var r = resolver.resolve(token("oid-4", Map.of("upn", "renamed@acme.test")));
    assertThat(r.user().id()).isEqualTo(id);
    assertThat(r.newlyLinked()).isFalse();
  }

  @Test
  void rejects_unverifiedEmailOnly() {
    String email = SsoTestData.uniqueEmail("choi");
    member(email);
    assertDenied(token("oid-5", Map.of("email", email, "xms_edov", false)), "unverified");
    assertDenied(token("oid-5", Map.of("email", email)), "unverified");
  }

  @Test
  void rejects_guestUpn() {
    member("guest_acme.test#EXT#@fabrikam.onmicrosoft.com");
    assertDenied(token("oid-6", Map.of("upn", "guest_acme.test#EXT#@fabrikam.onmicrosoft.com")), "unverified");
  }

  @Test
  void rejects_notRegistered_noJit() {
    long before = dsl.fetchCount(USER);
    assertDenied(token("oid-7", Map.of("upn", SsoTestData.uniqueEmail("nobody"))), "not_registered");
    assertThat(dsl.fetchCount(USER)).isEqualTo(before);
  }

  @Test
  void rejects_emailAndUpnPointingToDifferentUsers() {
    String a = SsoTestData.uniqueEmail("a");
    String b = SsoTestData.uniqueEmail("b");
    member(a);
    member(b);
    assertDenied(token("oid-8", Map.of("email", a, "xms_edov", true, "upn", b)), "conflict");
  }

  @Test
  void rejects_caseOnlyDuplicateUsernames() {
    String email = SsoTestData.uniqueEmail("dup");
    member(email);
    member(email.toUpperCase());
    assertDenied(token("oid-9", Map.of("upn", email)), "conflict");
  }

  @Test
  void rejects_userAlreadyLinkedToOtherOid() {
    String email = SsoTestData.uniqueEmail("linked");
    member(email);
    resolver.resolve(token("oid-10", Map.of("upn", email)));
    assertDenied(token("oid-11", Map.of("upn", email)), "conflict");
  }

  @Test
  void rejects_inactive_andDoesNotLink() {
    String email = SsoTestData.uniqueEmail("off");
    long id = member(email);
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(id)).execute();
    assertDenied(token("oid-12", Map.of("upn", email)), "inactive");
    assertThat(dsl.fetchCount(USER_EXTERNAL_IDENTITY, USER_EXTERNAL_IDENTITY.USER_ID.eq(id))).isZero();
  }

  @Test
  void rejects_noSsoWorkspace() {
    String email = SsoTestData.uniqueEmail("plain");
    long id = SsoTestData.user(dsl, email, null);
    SsoTestData.member(dsl, id, SsoTestData.tenant(dsl, false));
    assertDenied(token("oid-13", Map.of("upn", email)), "no_workspace");
  }

  @Test
  void rejects_agent() {
    String email = SsoTestData.uniqueEmail("bot");
    long id = member(email);
    dsl.update(USER).set(USER.KIND, "AGENT").where(USER.ID.eq(id)).execute();
    assertDenied(token("oid-14", Map.of("upn", email)), "agent");
  }

  private void assertDenied(Jwt jwt, String reason) {
    assertThatThrownBy(() -> resolver.resolve(jwt))
        .isInstanceOf(SsoLoginException.class)
        .satisfies(e -> {
          SsoLoginException s = (SsoLoginException) e;
          assertThat(s.webCode()).isEqualTo("denied");
          assertThat(s.reason()).isEqualTo(reason);
        });
  }
}
