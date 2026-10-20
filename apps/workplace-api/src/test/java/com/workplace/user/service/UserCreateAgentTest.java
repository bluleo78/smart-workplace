package com.workplace.user.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.CreateAgentRequest;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 5a — UserService.createAgent 통합 테스트. */
@Transactional
class UserCreateAgentTest extends IntegrationTestBase {

  // V44 가 시드하는 기본 테넌트(id=1, ACTIVE). 에이전트 생성은 active 테넌트 컨텍스트를 요구한다.
  private static final Long TENANT_ID = 1L;

  @Autowired private UserService userService;
  @Autowired private MembershipRepository membershipRepository;
  @Autowired private DSLContext dsl;

  private Long callerId;

  @BeforeEach
  void seedCaller() {
    // 에이전트 생성 경로는 인증된 ADMIN 요청이라 active 테넌트가 항상 존재한다 — 테스트에서도 시뮬레이트.
    TenantContext.set(TENANT_ID);
    callerId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "admin-caller-" + System.nanoTime())
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Admin Caller")
            .set(USER.EMAIL, "admin-caller-" + System.nanoTime() + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  @AfterEach
  void clearTenant() {
    // ThreadLocal 누수 방지 — 공유 스레드에 테넌트가 남으면 후속 테스트 클래스에 오염된다.
    TenantContext.clear();
  }

  @Test
  void create_agent_OK() {
    UserResponse agent =
        userService.createAgent(
            callerId,
            new CreateAgentRequest("bot-builder", "Build Bot", "bot-builder@example.com"));

    assertThat(agent.kind()).isEqualTo(UserKind.AGENT);
    String password =
        dsl.select(USER.PASSWORD).from(USER).where(USER.ID.eq(agent.id())).fetchOne(USER.PASSWORD);
    assertThat(password).isNull();
    String kind =
        dsl.select(USER.KIND).from(USER).where(USER.ID.eq(agent.id())).fetchOne(USER.KIND);
    assertThat(kind).isEqualTo("AGENT");
  }

  @Test
  void create_agent_provisions_membership_in_active_tenant() {
    // 신규 에이전트는 현재 active 테넌트에 단일 멤버십을 갖는다 — 콜백 시 RLS 컨텍스트 자동 해석용.
    UserResponse agent =
        userService.createAgent(
            callerId,
            new CreateAgentRequest("bot-membership", "Mem Bot", "bot-membership@example.com"));

    assertThat(membershipRepository.hasActiveMembership(agent.id(), TENANT_ID)).isTrue();
  }

  @Test
  void create_agent_without_tenant_context_throws() {
    // active 테넌트가 없으면 테넌트 없는 고아 에이전트가 되므로 생성을 거부한다.
    TenantContext.clear();
    assertThatThrownBy(
            () ->
                userService.createAgent(
                    callerId,
                    new CreateAgentRequest("bot-orphan", "Orphan", "bot-orphan@example.com")))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void create_agent_with_duplicate_username_throws() {
    userService.createAgent(
        callerId, new CreateAgentRequest("dup-bot", "Dup", "dup-bot@example.com"));
    assertThatThrownBy(
            () ->
                userService.createAgent(
                    callerId, new CreateAgentRequest("dup-bot", "Dup2", "dup-bot2@example.com")))
        .isInstanceOf(UsernameAlreadyExistsException.class);
  }

  @Test
  void create_agent_with_case_variant_email_throws() {
    // WP-613: 기존 구성원 이메일의 대소문자만 바꾼 이메일도 막는다.
    userService.createAgent(
        callerId, new CreateAgentRequest("bot-c", "C", "case-shared@example.com"));
    assertThatThrownBy(
            () ->
                userService.createAgent(
                    callerId, new CreateAgentRequest("bot-d", "D", "Case-Shared@EXAMPLE.COM")))
        .isInstanceOf(EmailAlreadyExistsException.class);
  }

  @Test
  void create_agent_with_duplicate_email_throws() {
    userService.createAgent(callerId, new CreateAgentRequest("bot-a", "A", "shared@example.com"));
    assertThatThrownBy(
            () ->
                userService.createAgent(
                    callerId, new CreateAgentRequest("bot-b", "B", "shared@example.com")))
        .isInstanceOf(EmailAlreadyExistsException.class);
  }

  /**
   * WP-600: 사람 구성원 아이디의 대소문자 변형으로는 에이전트를 만들 수 없다 — SSO 첫 연결 매칭이 대소문자 무시라 같은 아이디로 보이는 계정이 둘이면 그 구성원의
   * 연결이 「충돌」로 막힌다.
   */
  @Test
  void create_agent_with_case_variant_of_existing_username_throws() {
    String human = "case-human-" + System.nanoTime() + "@x.io";
    dsl.insertInto(USER)
        .set(USER.USERNAME, human)
        .set(USER.PASSWORD, "x")
        .set(USER.NAME, "사람")
        .set(USER.EMAIL, human)
        .execute();
    assertThatThrownBy(
            () ->
                userService.createAgent(
                    callerId,
                    new CreateAgentRequest(human.toUpperCase(), "가짜", "fake-case@example.com")))
        .isInstanceOf(UsernameAlreadyExistsException.class);
  }

  /** WP-600: 앞뒤 공백은 다듬어 저장하고, 다듬은 값으로 중복을 검사한다. */
  @Test
  void create_agent_trims_username() {
    UserResponse agent =
        userService.createAgent(
            callerId, new CreateAgentRequest("  trim-bot  ", "Trim", "trim-bot@example.com"));
    assertThat(agent.username()).isEqualTo("trim-bot");
    assertThatThrownBy(
            () ->
                userService.createAgent(
                    callerId,
                    new CreateAgentRequest("trim-bot ", "Trim2", "trim-bot2@example.com")))
        .isInstanceOf(UsernameAlreadyExistsException.class);
  }

  /** WP-600: 아이디 안의 공백·꺾쇠·따옴표·보이지 않는 문자는 거절한다(글자·숫자와 . _ @ + - 만). */
  @Test
  void create_agent_with_disallowed_username_chars_throws() {
    for (String bad : new String[] {"a b", "<i>", "bot\"x", "bot\u200Bx", "bot\tx"}) {
      assertThatThrownBy(
              () ->
                  userService.createAgent(
                      callerId,
                      new CreateAgentRequest(bad, "Bad", "bad-" + bad.hashCode() + "@x.io")))
          .as(bad)
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage("아이디에는 글자·숫자와 . _ @ + - 만 쓸 수 있습니다");
    }
  }
}
