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
  void create_agent_with_duplicate_email_throws() {
    userService.createAgent(callerId, new CreateAgentRequest("bot-a", "A", "shared@example.com"));
    assertThatThrownBy(
            () ->
                userService.createAgent(
                    callerId, new CreateAgentRequest("bot-b", "B", "shared@example.com")))
        .isInstanceOf(EmailAlreadyExistsException.class);
  }
}
