package com.workplace.global.security;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.service.UserApiTokenService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

/**
 * WP-845: 권한·자격 증명을 새로 만드는 관리 동작은 웹 로그인 세션에서만 — ADMIN 의 PAT 로는 403. PAT 로 비밀번호 계정·관리자 역할·AI 키를 만들 수
 * 있으면, 새어 나간 PAT 를 회수해도 그것으로 만든 계정·키로 계속 접근된다(WP-597 과 같은 기준).
 */
class RequireWebSessionTest extends IntegrationTestBase {

  private static final long DEFAULT_TENANT_ID = 1L;
  private static final String DENIED = "웹 로그인 세션에서만 할 수 있습니다";

  @Autowired private UserApiTokenService tokenService;
  @Autowired private DSLContext dsl;
  @Autowired private JwtTokenProvider jwt;
  @LocalServerPort private int port;

  private final RestTemplate rest = new RestTemplateBuilder().build();

  private Long adminId;
  private Long targetId;

  @BeforeEach
  void seed() {
    long n = System.nanoTime();
    adminId = createUser("admin-ws-" + n, "ADMIN");
    targetId = createUser("target-ws-" + n, "USER");
  }

  @AfterEach
  void cleanup() {
    for (Long userId : new Long[] {adminId, targetId}) {
      if (userId == null) continue;
      dsl.deleteFrom(com.workplace.jooq.Tables.AUDIT_LOG)
          .where(com.workplace.jooq.Tables.AUDIT_LOG.USER_ID.eq(userId))
          .execute();
      dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
    }
  }

  /** ADMIN 의 PAT 로 보낸 권한·자격 증명 생성 요청은 본문을 보기 전에 모두 403 이고 이유를 싣는다. */
  @Test
  void adminPat_cannotCreateCredentialsOrGrantRoles() {
    String pat = patBearer(adminId);
    long roleId = roleId("USER");
    List<String[]> calls =
        List.of(
            new String[] {"POST", "/api/v1/users"},
            new String[] {"PUT", "/api/v1/users/" + targetId + "/roles"},
            new String[] {"POST", "/api/v1/roles"},
            new String[] {"PUT", "/api/v1/roles/" + roleId + "/permissions"},
            new String[] {"POST", "/api/v1/admin/agents"},
            new String[] {"POST", "/api/v1/admin/agents/" + targetId + "/keys"},
            new String[] {"POST", "/api/v1/admin/agents/" + targetId + "/provider-credential"});
    for (String[] c : calls) {
      ResponseEntity<String> res = send(pat, HttpMethod.valueOf(c[0]), c[1], "{}");
      assertThat(res.getStatusCode()).as(c[0] + " " + c[1]).isEqualTo(HttpStatus.FORBIDDEN);
      assertThat(res.getBody()).as(c[0] + " " + c[1]).contains(DENIED);
    }
  }

  /** 관리자 역할 부여: 웹 세션이면 되고, 같은 ADMIN 의 PAT 로는 역할이 바뀌지 않는다. 읽기는 PAT 로도 된다. */
  @Test
  void roleGrant_webSessionOnly_readsStillWorkWithPat() {
    String body = "{\"roleIds\":[" + roleId("ADMIN") + "]}";
    String path = "/api/v1/users/" + targetId + "/roles";

    assertThat(send(patBearer(adminId), HttpMethod.PUT, path, body).getStatusCode())
        .isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(roleNamesOf(targetId)).containsExactly("USER");

    assertThat(
            send(patBearer(adminId), HttpMethod.GET, "/api/v1/users/" + targetId, null)
                .getStatusCode())
        .isEqualTo(HttpStatus.OK);

    assertThat(send(sessionBearer(adminId), HttpMethod.PUT, path, body).getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(roleNamesOf(targetId)).containsExactly("ADMIN");
  }

  /** 확인 카드 승인으로 역할을 주는 길(user.set_roles)도 PAT 로는 막힌다. 사전검증은 AI 가 카드를 만들 때 쓰므로 그대로 된다. */
  @Test
  void roleGrantViaConfirmAction_webSessionOnly() {
    String body =
        "{\"actionType\":\"user.set_roles\",\"params\":{\"userId\":"
            + targetId
            + ",\"roles\":[\"ADMIN\"]}}";

    ResponseEntity<String> denied =
        send(patBearer(adminId), HttpMethod.POST, "/api/v1/actions/confirm", body);
    assertThat(denied.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(denied.getBody()).contains(DENIED);
    assertThat(roleNamesOf(targetId)).containsExactly("USER");

    assertThat(
            send(patBearer(adminId), HttpMethod.POST, "/api/v1/actions/validate", body)
                .getStatusCode())
        .isEqualTo(HttpStatus.NO_CONTENT);

    assertThat(
            send(sessionBearer(adminId), HttpMethod.POST, "/api/v1/actions/confirm", body)
                .getStatusCode())
        .isEqualTo(HttpStatus.CREATED);
    assertThat(roleNamesOf(targetId)).containsExactly("ADMIN");
  }

  private Long createUser(String username, String role) {
    Long userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, username)
            .set(USER.EMAIL, username + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId(role))
        .execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, DEFAULT_TENANT_ID)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return userId;
  }

  private long roleId(String name) {
    return dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(name)).fetchOne(ROLE.ID);
  }

  private List<String> roleNamesOf(Long userId) {
    return dsl.select(ROLE.NAME)
        .from(USER_ROLE)
        .join(ROLE)
        .on(ROLE.ID.eq(USER_ROLE.ROLE_ID))
        .where(USER_ROLE.USER_ID.eq(userId))
        .fetch(ROLE.NAME);
  }

  /** 웹 로그인 세션과 같은 access JWT. */
  private String sessionBearer(Long userId) {
    return "Bearer " + jwt.generateAccessToken(userId, "u" + userId, DEFAULT_TENANT_ID);
  }

  /** 요청 밖에서 서비스로 직접 발급하므로 활성 테넌트를 수동으로 건다. */
  private String patBearer(Long userId) {
    TenantContext.set(DEFAULT_TENANT_ID);
    try {
      return "Bearer "
          + tokenService.issue(userId, new IssueUserTokenRequest("ws-test", null)).plaintextToken();
    } finally {
      TenantContext.clear();
    }
  }

  private ResponseEntity<String> send(String auth, HttpMethod method, String path, String json) {
    HttpHeaders headers = new HttpHeaders();
    headers.set("Authorization", auth);
    if (json != null) headers.setContentType(MediaType.APPLICATION_JSON);
    try {
      return rest.exchange(
          "http://localhost:" + port + path, method, new HttpEntity<>(json, headers), String.class);
    } catch (org.springframework.web.client.HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAsString());
    }
  }
}
