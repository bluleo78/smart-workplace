package com.workplace.issue.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.service.ChatFixtures;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-371 — 이슈·채팅 도메인 이벤트가 발행 시점(원 트랜잭션 안)에 "내부(INTERNAL) 에이전트 id 집합"을 싣는지 검증한다. dispatcher 는
 * AFTER_COMMIT @Async 로 DB 를 읽지 않으므로, 이 값이 외부 에이전트를 걸러내는 유일한 근거다.
 */
@RecordApplicationEvents
@Transactional
class AgentRuntimeEventGatingTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired IssueAssigneeService assigneeService;
  @Autowired IssueCommentService commentService;
  @Autowired IssueRepository issueRepository;
  @Autowired ApplicationEvents events;
  @Autowired ChatFixtures fx;
  @Autowired ChatThreadService threadService;
  @Autowired ChatMessageService messageService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private Long user(String prefix, String kind, String runtime) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, kind)
            .set(USER.AGENT_RUNTIME, runtime)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void 이슈_담당_지정과_코멘트_이벤트는_내부_에이전트_id만_싣는다() {
    Long owner = user("owner", "HUMAN", "INTERNAL");
    Long internal = user("in", "AGENT", "INTERNAL");
    Long external = user("ex", "AGENT", "EXTERNAL");
    String key =
        ("W" + UUID.randomUUID().toString().replace("-", "").toUpperCase()).substring(0, 6);
    var p = projectService.create(owner, new CreateProjectRequest(key, "P", "x"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(internal, "MEMBER"));
    projectService.addMember(owner, p.key(), new AddMemberRequest(external, "MEMBER"));
    var issue = issueRepository.insert(p.id(), 1, "t", null, "MID", null, owner);

    assigneeService.replace(owner, p.key(), 1, List.of(external, internal));
    commentService.create(owner, issue.id(), new CreateCommentRequest("hi"));

    var assigned = events.stream(IssueAssignedEvent.class).toList();
    assertThat(assigned).hasSize(1);
    assertThat(assigned.get(0).internalAgentIds()).containsExactly(internal);
    var commented = events.stream(IssueCommentedEvent.class).toList();
    assertThat(commented).hasSize(1);
    assertThat(commented.get(0).internalAgentIds()).containsExactly(internal);
  }

  @Test
  void 채팅_멘션_이벤트는_외부_에이전트를_내부_집합에서_뺀다() {
    ChatFixtures.AgentSetup s = fx.setupWithAgent();
    // 이 AGENT 를 EXTERNAL 로 전환 — 멘션해도 내부 집합이 비어야 한다.
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(s.agentId())).execute();
    var thread =
        threadService.getOrCreate(
            s.base().reporterId(), s.base().projectKey(), s.base().issueNumber());

    messageService.create(
        s.base().reporterId(),
        thread.threadId(),
        new CreateChatMessageRequest("<@" + s.agentId() + "> 도와줘"));

    var created = events.stream(ChatMessageCreatedEvent.class).toList();
    assertThat(created).hasSize(1);
    assertThat(created.get(0).mentions()).extracting(m -> m.id()).contains(s.agentId());
    assertThat(created.get(0).internalAgentIds()).isEmpty();

    dsl.update(USER).set(USER.AGENT_RUNTIME, "INTERNAL").where(USER.ID.eq(s.agentId())).execute();
    messageService.create(
        s.base().reporterId(),
        thread.threadId(),
        new CreateChatMessageRequest("<@" + s.agentId() + "> 다시"));
    var all = events.stream(ChatMessageCreatedEvent.class).toList();
    assertThat(all.get(all.size() - 1).internalAgentIds()).containsExactly(s.agentId());
  }
}
