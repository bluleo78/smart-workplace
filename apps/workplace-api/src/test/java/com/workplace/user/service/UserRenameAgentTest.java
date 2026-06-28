package com.workplace.user.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.CreateAgentRequest;
import com.workplace.user.dto.RenameAgentRequest;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.PersonalAssistantRenameForbiddenException;
import com.workplace.user.exception.UserNotFoundException;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** UserService.renameAgent 통합 테스트 — 이름/식별자 변경 + 개인 비서·예약어·중복 가드. */
@Transactional
class UserRenameAgentTest extends IntegrationTestBase {

  private static final Long TENANT_ID = 1L;

  @Autowired private UserService userService;
  @Autowired private DSLContext dsl;

  private Long callerId;

  @BeforeEach
  void seedCaller() {
    TenantContext.set(TENANT_ID);
    callerId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "rename-admin-" + System.nanoTime())
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Rename Admin")
            .set(USER.EMAIL, "rename-admin-" + System.nanoTime() + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 이름·아이디 변경이 반영되고, email 은 절대 변하지 않는다(클로버 회귀 가드). */
  @Test
  void rename_agent_changes_identity_but_preserves_email() {
    UserResponse agent =
        userService.createAgent(
            callerId, new CreateAgentRequest("r-bot", "R Bot", "r-bot@example.com"));

    userService.renameAgent(callerId, agent.id(), new RenameAgentRequest("r-bot2", "R Bot 2"));

    var row =
        dsl.select(USER.USERNAME, USER.NAME, USER.EMAIL)
            .from(USER)
            .where(USER.ID.eq(agent.id()))
            .fetchOne();
    assertThat(row.get(USER.USERNAME)).isEqualTo("r-bot2");
    assertThat(row.get(USER.NAME)).isEqualTo("R Bot 2");
    // email 은 rename 대상이 아니므로 생성 시 값 그대로여야 한다.
    assertThat(row.get(USER.EMAIL)).isEqualTo("r-bot@example.com");
  }

  /** 아이디는 그대로 두고 이름만 바꿔도 자기-중복으로 막히지 않는다(self-exclusion). */
  @Test
  void rename_same_username_only_name_OK() {
    UserResponse agent =
        userService.createAgent(
            callerId, new CreateAgentRequest("keep-id", "Old Name", "keep-id@example.com"));

    userService.renameAgent(callerId, agent.id(), new RenameAgentRequest("keep-id", "New Name"));

    String name =
        dsl.select(USER.NAME).from(USER).where(USER.ID.eq(agent.id())).fetchOne(USER.NAME);
    assertThat(name).isEqualTo("New Name");
  }

  /** 개인 비서(__assistant_u 접두어 AGENT)는 관리자가 변경할 수 없다(403). */
  @Test
  void rename_personal_assistant_forbidden() {
    Long personalAgentId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "__assistant_u" + System.nanoTime())
            .set(USER.NAME, "개인 비서")
            .set(USER.EMAIL, "assistant-" + System.nanoTime() + "@workplace.local")
            .set(USER.KIND, "AGENT")
            .returning(USER.ID)
            .fetchOne()
            .getId();

    assertThatThrownBy(
            () ->
                userService.renameAgent(
                    callerId, personalAgentId, new RenameAgentRequest("hacked", "Hacked")))
        .isInstanceOf(PersonalAssistantRenameForbiddenException.class);
  }

  /** 예약 접두어(__assistant_u)로 username 을 바꾸면 거부(목록 누락·rename 영구불가 방지). */
  @Test
  void rename_to_reserved_prefix_username_throws() {
    UserResponse agent =
        userService.createAgent(
            callerId, new CreateAgentRequest("normal-bot", "Normal", "normal-bot@example.com"));

    assertThatThrownBy(
            () ->
                userService.renameAgent(
                    callerId, agent.id(), new RenameAgentRequest("__assistant_u999", "Sneaky")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** 다른 유저가 쓰는 아이디로 변경 시 409. */
  @Test
  void rename_to_duplicate_username_throws() {
    userService.createAgent(
        callerId, new CreateAgentRequest("taken", "Taken", "taken@example.com"));
    UserResponse agent2 =
        userService.createAgent(
            callerId, new CreateAgentRequest("free", "Free", "free@example.com"));

    assertThatThrownBy(
            () ->
                userService.renameAgent(
                    callerId, agent2.id(), new RenameAgentRequest("taken", "Free2")))
        .isInstanceOf(UsernameAlreadyExistsException.class);
  }

  /** 존재하지 않는 유저 → 404. */
  @Test
  void rename_nonexistent_throws() {
    assertThatThrownBy(
            () -> userService.renameAgent(callerId, 99_999_999L, new RenameAgentRequest("x", "X")))
        .isInstanceOf(UserNotFoundException.class);
  }

  /** AGENT 가 아닌 유저(HUMAN)는 변경 불가 → 400. */
  @Test
  void rename_non_agent_throws() {
    assertThatThrownBy(
            () ->
                userService.renameAgent(
                    callerId, callerId, new RenameAgentRequest("human-new", "Human New")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
