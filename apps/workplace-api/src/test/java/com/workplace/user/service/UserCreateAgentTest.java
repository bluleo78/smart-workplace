package com.workplace.user.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.CreateAgentRequest;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 5a — UserService.createAgent 통합 테스트. */
@Transactional
class UserCreateAgentTest extends IntegrationTestBase {

  @Autowired private UserService userService;
  @Autowired private DSLContext dsl;

  private Long callerId;

  @BeforeEach
  void seedCaller() {
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
