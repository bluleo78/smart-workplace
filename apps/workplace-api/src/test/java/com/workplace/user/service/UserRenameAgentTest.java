package com.workplace.user.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.audit.dto.AuditLogResponse;
import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.CreateAgentRequest;
import com.workplace.user.dto.RenameAgentRequest;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.PersonalAssistantRenameForbiddenException;
import com.workplace.user.exception.UserNotFoundException;
import java.util.List;
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
  @Autowired private AuditLogService auditLogService;

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

  /**
   * username 은 그대로 두고 name 만 바꿔도 감사 로그 설명에 이름 변경분이 반영된다(#796 회귀 가드). 수정 전에는 "AGENT 유저 변경: username
   * → username" 처럼 좌우가 동일해 변경이 없었던 것처럼 보였다.
   */
  @Test
  void rename_name_only_reflects_in_audit_log_description() {
    UserResponse agent =
        userService.createAgent(
            callerId, new CreateAgentRequest("code-bot", "코드리뷰어", "code-bot@example.com"));

    userService.renameAgent(callerId, agent.id(), new RenameAgentRequest("code-bot", "코드리뷰어2"));

    List<AuditLogResponse> logs =
        auditLogService.findByResource("AGENT_RENAMED", "user", String.valueOf(agent.id()));
    assertThat(logs).hasSize(1);
    String description = logs.get(0).description();
    assertThat(description).contains("이름 코드리뷰어 → 코드리뷰어2");
    // username 은 변경되지 않았으므로 "아이디 ..." 문구는 포함되지 않아야 한다.
    assertThat(description).doesNotContain("아이디");
  }

  /** username 만 바꾸면 감사 로그 설명에 아이디 변경분만 반영되고 이름 문구는 없다. */
  @Test
  void rename_username_only_reflects_in_audit_log_description() {
    UserResponse agent =
        userService.createAgent(
            callerId, new CreateAgentRequest("old-id", "Same Name", "old-id@example.com"));

    userService.renameAgent(callerId, agent.id(), new RenameAgentRequest("new-id", "Same Name"));

    List<AuditLogResponse> logs =
        auditLogService.findByResource("AGENT_RENAMED", "user", String.valueOf(agent.id()));
    assertThat(logs).hasSize(1);
    String description = logs.get(0).description();
    assertThat(description).contains("아이디 old-id → new-id");
    assertThat(description).doesNotContain("이름");
  }

  /** username·name 둘 다 바뀌면 감사 로그 설명에 두 변경분이 모두 포함된다. */
  @Test
  void rename_both_fields_reflects_both_in_audit_log_description() {
    UserResponse agent =
        userService.createAgent(
            callerId, new CreateAgentRequest("both-old", "Old Name", "both-old@example.com"));

    userService.renameAgent(callerId, agent.id(), new RenameAgentRequest("both-new", "New Name"));

    List<AuditLogResponse> logs =
        auditLogService.findByResource("AGENT_RENAMED", "user", String.valueOf(agent.id()));
    assertThat(logs).hasSize(1);
    String description = logs.get(0).description();
    assertThat(description).contains("아이디 both-old → both-new");
    assertThat(description).contains("이름 Old Name → New Name");
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
