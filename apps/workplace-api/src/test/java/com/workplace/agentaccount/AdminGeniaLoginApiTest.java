package com.workplace.agentaccount;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.GeniaLoginStartRequest;
import com.workplace.agentaccount.genialogin.GeniaLoginClient;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.GeniaLoginUnavailable;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.LoginStart;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.PollResult;
import com.workplace.agentaccount.genialogin.GeniaLoginService;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.auth.service.AgentProviders;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1461 Gen:iA 브라우저 로그인 관리자 API 통합 테스트 — 시작(비밀 미노출), 상태 조회 안의 폴링(대기·간격 증가·만료·실패·일시 장애), 성공 때 붙여
 * 넣기와 같은 모양의 계정 생성·다시 로그인, 한 사람 한 진행, 남의 진행 404, 권한(관리자·웹 세션). Gen:iA 서버는 spy 로 스텁하고 토큰 값은 모두 가짜다.
 */
@Transactional
class AdminGeniaLoginApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/admin/agent-accounts/genia-logins";
  private static final String ACCOUNTS = "/api/v1/admin/agent-accounts";

  /** 스텁 state — 응답 어디에도 나오면 안 되는 비밀. */
  private static final String STATE = "st-SECRET-genia-state-value";

  private static final String AUTHORIZE_URL = "https://login.example.test/authorize?client=x";
  private static final Instant TOKEN_EXPIRES = Instant.parse("2026-12-12T00:00:00Z");

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentAccountRepository accounts;
  @Autowired EncryptionService encryption;
  @Autowired GeniaLoginClient geniaClient;
  @Autowired GeniaLoginService geniaLogins;

  private long admin;

  /** 워크스페이스 1 의 관리자를 시드한다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
  }

  /** 웹 로그인 세션 인증(user:write) — 모든 Gen:iA 로그인 API 가 @RequireWebSession 이다. */
  private Authentication auth(long userId) {
    return WebSessionAuth.of(userId, List.of(new SimpleGrantedAuthority("user:write")));
  }

  /** 요청 필터가 끝나면 TenantContext 가 비워지므로 매 호출 전에 테넌트를 다시 맞춘다. */
  private ResultActions call(MockHttpServletRequestBuilder b, long caller) throws Exception {
    TenantContext.set(1L);
    return mvc.perform(b.with(authentication(auth(caller))));
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  /** Gen:iA 시작 응답을 스텁한다 — interval 0 이면 조회마다 폴링한다. */
  private void stubStart(int interval, Instant expiresAt) throws Exception {
    doReturn(new LoginStart(AUTHORIZE_URL, STATE, interval, expiresAt))
        .when(geniaClient)
        .start(anyString());
  }

  /** 10분 뒤 만료·간격 0 의 기본 시작 스텁. */
  private void stubStart() throws Exception {
    stubStart(0, Instant.now().plus(10, ChronoUnit.MINUTES));
  }

  private void stubPoll(PollResult first, PollResult... rest) {
    doReturn(first, (Object[]) rest).when(geniaClient).poll(anyString(), anyString());
  }

  private ResultActions start(String label, Long accountId, long caller) throws Exception {
    return call(
        post(BASE)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(new GeniaLoginStartRequest(label, accountId))),
        caller);
  }

  /** 시작하고 진행 id 를 돌려준다(201 확인). */
  private String startId(String label, Long accountId) throws Exception {
    return json(start(label, accountId, admin).andExpect(status().isCreated())).get("id").asText();
  }

  private ResultActions getLogin(String id) throws Exception {
    return call(get(BASE + "/" + id), admin);
  }

  private static PollResult.Success success(String token, String email) {
    return new PollResult.Success(token, TOKEN_EXPIRES, email, "member");
  }

  /** 붙여 넣기 경로로 Gen:iA 계정을 만든다. */
  private long pasteGenia(String label, String email, String access) throws Exception {
    String loginInfo =
        "{\"genia\":{\"type\":\"oauth\",\"access\":\""
            + access
            + "\",\"refresh\":\""
            + access
            + "\",\"expires\":1797033600000,\"email\":\""
            + email
            + "\"}}";
    return json(call(
                post(ACCOUNTS)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        om.writeValueAsString(
                            new AgentAccountRequest("genia", null, null, label, loginInfo, null))),
                admin)
            .andExpect(status().isCreated()))
        .get("id")
        .asLong();
  }

  /** 저장된 원문(복호화한 auth.json)의 genia 객체. */
  private JsonNode storedGenia(long accountId) throws Exception {
    String plain =
        encryption.decrypt(accounts.findActive(accountId).orElseThrow().encryptedSecret());
    return om.readTree(plain).get("genia");
  }

  @Test
  void start_returnsAuthorizeUrlWithoutSecrets() throws Exception {
    stubStart();

    ResultActions r =
        start("팀 Gen:iA", null, admin)
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").isNotEmpty())
            .andExpect(jsonPath("$.status").value("PENDING"))
            .andExpect(jsonPath("$.authorizeUrl").value(AUTHORIZE_URL))
            .andExpect(jsonPath("$.expiresAt").isNotEmpty());

    String body = r.andReturn().getResponse().getContentAsString();
    assertThat(body).doesNotContain(STATE).doesNotContain("verifier").doesNotContain("\"state\"");
    ArgumentCaptor<String> challenge = ArgumentCaptor.forClass(String.class);
    verify(geniaClient).start(challenge.capture());
    // S256 challenge = base64url(SHA-256) 43자.
    assertThat(challenge.getValue()).matches("[A-Za-z0-9_-]{43}");
  }

  @Test
  void pendingThenSuccess_createsGeniaAccountWithPasteShape() throws Exception {
    stubStart();
    stubPoll(new PollResult.Pending(), success("tok-1", "me@iacloud.kr"));
    String id = startId("내 Gen:iA", null);

    getLogin(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING"));
    JsonNode done =
        json(
            getLogin(id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUCCEEDED"))
                .andExpect(jsonPath("$.accountEmail").value("me@iacloud.kr")));
    long accountId = done.get("accountId").asLong();

    var row = accounts.findActive(accountId).orElseThrow();
    assertThat(row.provider()).isEqualTo("genia");
    assertThat(row.label()).isEqualTo("내 Gen:iA");
    JsonNode genia = storedGenia(accountId);
    assertThat(genia.get("type").asText()).isEqualTo("oauth");
    assertThat(genia.get("access").asText()).isEqualTo("tok-1");
    assertThat(genia.get("refresh").asText()).isEqualTo("tok-1");
    assertThat(genia.get("expires").asLong()).isEqualTo(1797033600000L);
    assertThat(genia.get("email").asText()).isEqualTo("me@iacloud.kr");
    assertThat(genia.get("role").asText()).isEqualTo("member");
    assertThat(done.toString()).doesNotContain("tok-1");

    // 끝난 진행은 같은 결과를 다시 돌려주고 Gen:iA 를 더 부르지 않는다(멱등).
    getLogin(id)
        .andExpect(jsonPath("$.status").value("SUCCEEDED"))
        .andExpect(jsonPath("$.accountId").value(accountId));
    verify(geniaClient, times(2)).poll(anyString(), anyString());
  }

  @Test
  void start_withoutLabel_usesDefaultLabel() throws Exception {
    stubStart();
    stubPoll(success("tok-2", "nolabel@iacloud.kr"));
    String id = startId(" ", null);

    long accountId =
        json(getLogin(id).andExpect(jsonPath("$.status").value("SUCCEEDED")))
            .get("accountId")
            .asLong();

    // 기본 라벨은 붙여 넣기와 같은 곳(AgentAccountService)이 정한다 — 「<종류 이름> 계정」.
    assertThat(accounts.findActive(accountId).orElseThrow().label())
        .isEqualTo(AgentProviders.label(AgentProviders.GENIA) + " 계정");
  }

  /** Gen:iA 가 expires_at 을 주지 않아도 실패로 끝내지 않고 Gen:iA 토큰 수명(30일)으로 채워 저장한다. */
  @Test
  void successWithoutExpiry_savesWithThirtyDayExpiry() throws Exception {
    stubStart();
    stubPoll(new PollResult.Success("tok-noexp", null, "noexp@iacloud.kr", "member"));
    String id = startId(null, null);
    Instant before = Instant.now();

    long accountId =
        json(getLogin(id).andExpect(jsonPath("$.status").value("SUCCEEDED")))
            .get("accountId")
            .asLong();

    long expires = storedGenia(accountId).get("expires").asLong();
    assertThat(Instant.ofEpochMilli(expires))
        .isBetween(
            before.plus(30, ChronoUnit.DAYS).minusSeconds(60),
            Instant.now().plus(30, ChronoUnit.DAYS).plusSeconds(60));
  }

  /** 폴링 중에 창을 닫아(취소) 진행이 취소됐으면, 그 폴링이 성공을 받아도 계정을 저장하지 않는다. */
  @Test
  void cancelDuringPoll_doesNotSaveAccount() throws Exception {
    stubStart();
    int before = accounts.findAllActive().size();
    String id = startId(null, null);
    // 폴링 응답이 오기 전에 취소가 들어온 순서를 결정적으로 만든다 — 같은 스레드라 진행 잠금은 재진입으로 잡힌다.
    doAnswer(
            inv -> {
              geniaLogins.cancel(admin, id);
              return success("tok-canceled", "canceled@iacloud.kr");
            })
        .when(geniaClient)
        .poll(anyString(), anyString());

    getLogin(id).andExpect(status().isOk());

    assertThat(accounts.findAllActive()).hasSize(before);
    getLogin(id).andExpect(status().isNotFound());
  }

  @Test
  void slowDown_waitsLongerBeforeNextPoll() throws Exception {
    stubStart(0, Instant.now().plus(10, ChronoUnit.MINUTES));
    stubPoll(new PollResult.SlowDown());
    String id = startId(null, null);

    getLogin(id).andExpect(jsonPath("$.status").value("PENDING"));
    // 간격이 5초 늘었으므로 곧바로 다시 조회해도 Gen:iA 를 부르지 않는다.
    getLogin(id).andExpect(jsonPath("$.status").value("PENDING"));
    verify(geniaClient, times(1)).poll(anyString(), anyString());
  }

  @Test
  void expiredToken_returnsExpired() throws Exception {
    stubStart();
    stubPoll(new PollResult.Expired());
    int before = accounts.findAllActive().size();
    String id = startId(null, null);

    getLogin(id)
        .andExpect(jsonPath("$.status").value("EXPIRED"))
        .andExpect(jsonPath("$.accountId").doesNotExist());
    assertThat(accounts.findAllActive()).hasSize(before);
  }

  @Test
  void pastExpiry_returnsExpiredWithoutPolling() throws Exception {
    stubStart(0, Instant.now().minusSeconds(1));
    String id = startId(null, null);

    getLogin(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("EXPIRED"));
    verify(geniaClient, never()).poll(anyString(), anyString());
  }

  @Test
  void authenticationError_returnsFailedWithReason() throws Exception {
    stubStart();
    stubPoll(new PollResult.Failed("authentication_error"));
    String id = startId(null, null);

    String msg =
        json(getLogin(id).andExpect(jsonPath("$.status").value("FAILED")))
            .get("errorMessage")
            .asText();
    assertThat(msg).contains("authentication_error");
  }

  @Test
  void unavailableDuringPoll_staysPending() throws Exception {
    stubStart();
    stubPoll(new PollResult.Unavailable("network"));
    String id = startId(null, null);

    getLogin(id).andExpect(jsonPath("$.status").value("PENDING"));
  }

  /** 폴링을 스텁하지 않으면 실제 빈이 테스트 설정(127.0.0.1:9)으로 나가 연결에 실패한다 — 빈 구성 확인 겸 PENDING 유지. */
  @Test
  void unstubbedPoll_usesRealClientAndStaysPending() throws Exception {
    stubStart();
    String id = startId(null, null);

    getLogin(id).andExpect(jsonPath("$.status").value("PENDING"));
    verify(geniaClient).poll(anyString(), anyString());
  }

  @Test
  void duplicateAccount_returnsFailedWithConflictMessage() throws Exception {
    pasteGenia("붙여 넣은 계정", "dup@iacloud.kr", "paste-tok");
    int before = accounts.findAllActive().size();
    stubStart();
    stubPoll(success("tok-3", "dup@iacloud.kr"));
    String id = startId(null, null);

    String msg =
        json(getLogin(id).andExpect(jsonPath("$.status").value("FAILED")))
            .get("errorMessage")
            .asText();
    assertThat(msg).contains("같은 키의 계정이 이미 있어요");
    assertThat(accounts.findAllActive()).hasSize(before);
  }

  @Test
  void cancel_removesSession() throws Exception {
    stubStart();
    String id = startId(null, null);

    call(delete(BASE + "/" + id), admin).andExpect(status().isNoContent());
    getLogin(id).andExpect(status().isNotFound());
    verify(geniaClient, never()).poll(anyString(), anyString());
    // 없는 진행 취소도 204(창 닫기 취소는 멱등).
    call(delete(BASE + "/no-such-login"), admin).andExpect(status().isNoContent());
  }

  @Test
  void newStart_replacesPreviousSessionOfSameUser() throws Exception {
    stubStart();
    String first = startId(null, null);
    String second = startId(null, null);

    assertThat(second).isNotEqualTo(first);
    getLogin(first)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("GENIA_LOGIN_NOT_FOUND"));
    getLogin(second).andExpect(status().isOk());
  }

  @Test
  void otherUser_cannotReadSession() throws Exception {
    stubStart();
    String id = startId(null, null);
    long otherAdmin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, otherAdmin, "ADMIN");

    call(get(BASE + "/" + id), otherAdmin).andExpect(status().isNotFound());
    // 남의 진행은 취소로도 지우지 못한다.
    call(delete(BASE + "/" + id), otherAdmin).andExpect(status().isNoContent());
    getLogin(id).andExpect(status().isOk());
  }

  @Test
  void startServerDown_isBadGateway() throws Exception {
    doThrow(new GeniaLoginUnavailable("network")).when(geniaClient).start(anyString());

    start(null, null, admin)
        .andExpect(status().isBadGateway())
        .andExpect(jsonPath("$.errors.code").value("GENIA_LOGIN_UNAVAILABLE"));
  }

  @Test
  void relogin_replacesOnlyLoginInfoOfTargetAccount() throws Exception {
    long acc = pasteGenia("팀 Gen:iA", "team@iacloud.kr", "old-tok");
    accounts.updateStatus(acc, AgentAccountService.STATUS_RELOGIN_REQUIRED);
    long versionBefore = accounts.findActive(acc).orElseThrow().secretVersion();
    int before = accounts.findAllActive().size();
    stubStart();
    stubPoll(success("new-tok", "team@iacloud.kr"));
    String id = startId("무시되는 라벨", acc);

    getLogin(id)
        .andExpect(jsonPath("$.status").value("SUCCEEDED"))
        .andExpect(jsonPath("$.accountId").value(acc))
        .andExpect(jsonPath("$.accountEmail").value("team@iacloud.kr"));

    var row = accounts.findActive(acc).orElseThrow();
    assertThat(row.label()).isEqualTo("팀 Gen:iA");
    assertThat(row.secretVersion()).isGreaterThan(versionBefore);
    assertThat(row.status()).isEqualTo(AgentAccountService.STATUS_ACTIVE);
    assertThat(storedGenia(acc).get("access").asText()).isEqualTo("new-tok");
    assertThat(accounts.findAllActive()).hasSize(before);
  }

  /** 다시 로그인 창에서 다른 Gen:iA 계정으로 로그인하면 기존 로그인 정보를 바꾸지 않고 실패로 알린다. */
  @Test
  void relogin_withDifferentEmail_failsAndKeepsCredentials() throws Exception {
    long acc = pasteGenia("팀 Gen:iA", "team@iacloud.kr", "old-tok");
    long versionBefore = accounts.findActive(acc).orElseThrow().secretVersion();
    stubStart();
    stubPoll(success("other-tok", "someone-else@iacloud.kr"));
    String id = startId(null, acc);

    String msg =
        json(getLogin(id).andExpect(jsonPath("$.status").value("FAILED")))
            .get("errorMessage")
            .asText();

    assertThat(msg).isEqualTo("다른 Gen:iA 계정으로 로그인했어요 — team@iacloud.kr 로 로그인해 주세요");
    var row = accounts.findActive(acc).orElseThrow();
    assertThat(row.secretVersion()).isEqualTo(versionBefore);
    assertThat(storedGenia(acc).get("access").asText()).isEqualTo("old-tok");
  }

  /** 이메일 대소문자만 다르면 같은 계정으로 보고 다시 로그인한다. */
  @Test
  void relogin_withSameEmailDifferentCase_succeeds() throws Exception {
    long acc = pasteGenia("팀 Gen:iA", "team@iacloud.kr", "old-tok");
    stubStart();
    stubPoll(success("new-tok", "Team@IACLOUD.kr"));
    String id = startId(null, acc);

    getLogin(id).andExpect(jsonPath("$.status").value("SUCCEEDED"));
    assertThat(storedGenia(acc).get("access").asText()).isEqualTo("new-tok");
  }

  @Test
  void relogin_nonGeniaAccount_isBadRequest() throws Exception {
    long acc =
        json(call(
                    post(ACCOUNTS)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                            om.writeValueAsString(
                                new AgentAccountRequest(
                                    "anthropic",
                                    "sk-ant-oat01-" + "Q".repeat(40),
                                    null,
                                    null,
                                    null,
                                    null))),
                    admin)
                .andExpect(status().isCreated()))
            .get("id")
            .asLong();
    stubStart();

    start(null, acc, admin).andExpect(status().isBadRequest());
    verify(geniaClient, never()).start(anyString());
  }

  @Test
  void relogin_unknownAccount_isNotFound() throws Exception {
    stubStart();

    start(null, 987_654_321L, admin)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ACCOUNT_NOT_FOUND"));
  }

  @Test
  void nonAdmin_forbidden() throws Exception {
    stubStart();
    long member = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));

    start(null, null, member).andExpect(status().isForbidden());
    call(get(BASE + "/x"), member).andExpect(status().isForbidden());
    call(delete(BASE + "/x"), member).andExpect(status().isForbidden());
    verify(geniaClient, never()).start(anyString());
  }

  /** 웹 로그인 세션이 아닌 인증(PAT·AI 키처럼 AuthDetails 없음)은 관리자여도 403. */
  @Test
  void nonWebSession_forbidden() throws Exception {
    stubStart();
    var nonWeb =
        new UsernamePasswordAuthenticationToken(
            admin, "n/a", List.of(new SimpleGrantedAuthority("user:write")));
    TenantContext.set(1L);

    mvc.perform(
            post(BASE)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new GeniaLoginStartRequest(null, null)))
                .with(authentication(nonWeb)))
        .andExpect(status().isForbidden());
    verify(geniaClient, never()).start(anyString());
  }

  @Test
  void responseToStringHidesSecrets() {
    var started = new LoginStart(AUTHORIZE_URL, STATE, 2, TOKEN_EXPIRES);
    var ok = success("tok-SECRET-access", "me@iacloud.kr");

    assertThat(started.toString()).doesNotContain(STATE);
    assertThat(ok.toString()).doesNotContain("tok-SECRET-access").contains("me@iacloud.kr");
  }
}
