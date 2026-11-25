package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_RUN_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.auth.service.UserApiTokenService;
import com.workplace.chat.outbound.ChatAgentWake;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatMessageOrigin;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.global.security.AgentToolContext;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.AgentsResumedByChatReply;
import com.workplace.issue.outbound.ImplicitChatAgents;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.outbound.RecurringQuestionAnswers;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeWakeEvent;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.ServerAgentResolver;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-2093 질문 이동 → 이슈 챗 질문. AI 가 outcome `ask` 로 이동하며 남기는 의견은 이슈 댓글이 아니라 이슈 챗의 「답변 필요
 * 질문」(IS_QUESTION)으로 올라가 사람이 챗에서 보고 답하게 하고, 질문이 아닌 이동의 의견은 예전처럼 댓글이다. 질문 대기 중 사람이 화면에서 쓴 챗 글은
 * answered 이동이 되어 질문한 AI 노드로 돌아간다(AI 글·보고 글·첨부만·멈춤·질문 대기 아님·댓글은 답이 아니다).
 */
@RecordApplicationEvents
@Transactional
class WorkflowAskChatTest extends IntegrationTestBase {

  private static final String API = "/api/v1";
  private static final String QUESTION = "어느 쪽으로 할까요?\n- A\n- B";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired ApplicationEvents events;
  @Autowired AgentApiKeyService agentKeyService;
  @Autowired ChatThreadRepository chatThreadRepository;
  @Autowired UserApiTokenService userTokenService;
  // IntegrationTestBase 의 공통 spy — 호출 여부 확인·실패 주입에 쓴다.
  @Autowired ImplicitChatAgents implicitAgents;
  @Autowired RecurringQuestionAnswers recurringAnswers;
  @Autowired WorkflowRunRepository runRepository;
  @Autowired ServerAgentResolver serverAgentResolver;

  private long pm;
  private long lead;
  private String key;
  private long projectId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    pm = human();
    lead = human();
    key = "WK" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
    projectId = projectService.create(pm, new CreateProjectRequest(key, "질문", "x", "TEAM")).id();
    TenantContext.set(1L);
    projectService.addMember(pm, key, new AddMemberRequest(lead, "MEMBER"));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  @DisplayName("ask 이동은 의견을 이슈 챗 질문으로 올리고 댓글은 만들지 않으며 _qa 에 질문 글 id 를 남긴다")
  void askMove_postsChatQuestion_notComment() {
    long bot = agent();
    long issue = startedIssue(bot);

    JsonNode moved = expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);

    var rows =
        dsl.select(
                CHAT_MESSAGE.ID,
                CHAT_MESSAGE.AUTHOR_ID,
                CHAT_MESSAGE.IS_QUESTION,
                CHAT_MESSAGE.BODY)
            .from(CHAT_MESSAGE)
            .join(CHAT_THREAD)
            .on(CHAT_THREAD.ID.eq(CHAT_MESSAGE.THREAD_ID))
            .where(CHAT_THREAD.ISSUE_ID.eq(issue))
            .fetch();
    assertThat(rows).hasSize(1);
    assertThat(rows.getFirst().get(CHAT_MESSAGE.IS_QUESTION)).isTrue();
    assertThat(rows.getFirst().get(CHAT_MESSAGE.AUTHOR_ID)).isEqualTo(bot);
    assertThat(rows.getFirst().get(CHAT_MESSAGE.BODY)).isEqualTo(QUESTION);
    assertThat(dsl.fetchCount(ISSUE_COMMENT, ISSUE_COMMENT.ISSUE_ID.eq(issue))).isZero();
    assertThat(nodeRunCommentId(issue, "work")).isNull();
    JsonNode qa = moved.get("context").get("_qa").get(0);
    assertThat(qa.get("question").asString()).isEqualTo(QUESTION);
    assertThat(qa.get("questionMessageId").asLong())
        .isEqualTo(rows.getFirst().get(CHAT_MESSAGE.ID));
  }

  @Test
  @DisplayName("ask 이동이 올린 챗 글은 AI 질문 알림 출처(REPORT_QUESTION)로 이벤트가 난다")
  void askMove_firesAiQuestionNotification() {
    long bot = agent();
    long issue = startedIssue(bot);
    events.clear();

    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);

    List<ChatMessageCreatedEvent> created = events.stream(ChatMessageCreatedEvent.class).toList();
    assertThat(created).hasSize(1);
    assertThat(created.getFirst().origin()).isEqualTo(ChatMessageOrigin.REPORT_QUESTION);
  }

  @Test
  @DisplayName("질문이 아닌 이동의 의견은 예전처럼 이슈 댓글이고 챗 글은 없다")
  void nonQuestionMove_stillWritesComment() {
    long bot = agent();
    long issue = startedIssue(bot);
    ok(move(issue, "work", "done", null, 0, "k-done"), pm);

    ok(move(issue, "check", "ok", "확인했습니다", 1, "k-ok"), pm);

    assertThat(dsl.fetchCount(ISSUE_COMMENT, ISSUE_COMMENT.ISSUE_ID.eq(issue))).isEqualTo(1);
    assertThat(nodeRunCommentId(issue, "check")).isNotNull();
    assertThat(
            dsl.fetchCount(
                CHAT_MESSAGE,
                CHAT_MESSAGE.THREAD_ID.in(
                    dsl.select(CHAT_THREAD.ID)
                        .from(CHAT_THREAD)
                        .where(CHAT_THREAD.ISSUE_ID.eq(issue)))))
        .isZero();
  }

  // ───────────────────────── 챗 답 = answered (Task 2) ─────────────────────────

  @Test
  @DisplayName("질문 대기 중 사람(담당 아님이어도 구성원)의 챗 글은 answered 이동으로 AI 노드로 되돌리고 AI 를 깨운다")
  void humanChatReply_movesAnswered_backToAgentNode() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    long other = human();
    projectService.addMember(pm, key, new AddMemberRequest(other, "MEMBER"));
    TenantContext.set(1L);

    long msg = chat(issue, other, "A 로 해 주세요");

    var run = run(issue);
    assertThat(run.get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work");
    assertThat(run.get(WORKFLOW_RUN.STATUS)).isEqualTo("RUNNING");
    assertThat(run.get(WORKFLOW_RUN.REVISION)).isEqualTo(2);
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    List<WorkflowNodeWakeEvent> wakes = events.stream(WorkflowNodeWakeEvent.class).toList();
    assertThat(wakes).hasSize(2);
    assertThat(wakes.get(1).agentIds()).containsExactly(bot);
    JsonNode qa = om.readTree(run.get(WORKFLOW_RUN.CONTEXT).data()).get("_qa").get(0);
    assertThat(qa.get("answer").asString()).isEqualTo("A 로 해 주세요");
    assertThat(qa.get("answeredBy").asLong()).isEqualTo(other);
    assertThat(qa.get("answerMessageId").asLong()).isEqualTo(msg);
    assertThat(dsl.fetchCount(ISSUE_COMMENT, ISSUE_COMMENT.ISSUE_ID.eq(issue))).isZero();
    // 챗 답은 관리자 대리가 아니다 — 이동 이벤트에 override 로 적지 않는다.
    assertThat(lastMovedOverride(issue)).isFalse();
  }

  @Test
  @DisplayName("질문 대기 중 AI 가 쓴 챗 글은 답이 아니다 — 실행 그대로, 글은 저장")
  void agentChatPost_whileAsking_doesNotMove() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);

    String token = agentKeyService.issue(pm, bot, new IssueAgentKeyRequest("wf")).plaintextKey();
    var req =
        post(API + "/chat/threads/" + threadOf(issue) + "/messages")
            .content(json("body", "제가 더 볼게요"))
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + token)
            .header(AgentToolContext.HEADER, "claude-code");
    assertThat(status(req)).isEqualTo(201);

    assertAsking(issue);
    assertThat(chatBodies(issue)).contains("제가 더 볼게요");
  }

  @Test
  @DisplayName("질문 대기 중 사람이 AI 도구 보고(report_agent_work message)로 남긴 글은 답이 아니다")
  void reportMessage_whileAsking_doesNotMove() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);

    // 사람이 자기 AI 도구(PAT + 수행 도구 헤더)로 보고한 글 — 보고 경로(REPORT)라 사람의 답으로 치지 않는다.
    String pat =
        userTokenService.issue(lead, new IssueUserTokenRequest("wf", null)).plaintextToken();
    var req =
        put(API + "/projects/" + key + "/issues/" + number(issue) + "/agent-work")
            .content(json("state", "WORKING", "message", "A 로 해 주세요"))
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + pat)
            .header(AgentToolContext.HEADER, "claude-code");
    assertThat(status(req)).isBetween(200, 299);

    assertAsking(issue);
    assertThat(chatBodies(issue)).contains("A 로 해 주세요");
  }

  @Test
  @DisplayName("질문 대기 중 첨부만 있는 사람 글(보이는 글자 없음)은 답이 아니다 — 글은 저장")
  void attachmentOnlyReply_doesNotMove() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    long fileId =
        expect(
                post(API + "/staged-files/text").content(json("name", "a.txt", "content", "내용")),
                lead,
                201)
            .get("fileId")
            .asLong();

    expect(
        post(API + "/chat/threads/" + threadOf(issue) + "/messages")
            .content(json("body", "", "fileIds", List.of(fileId))),
        lead,
        201);

    assertAsking(issue);
    assertThat(chatBodies(issue)).hasSize(2);
  }

  @Test
  @DisplayName("질문 대기 중 멘션 토큰뿐인 사람 글(「@담당자」만)은 답이 아니다 — 실행 그대로, 글은 저장")
  void mentionOnlyReply_doesNotMove() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    // 멘션 둘과 공백·폭 없는 공백만 — 토큰을 빼면 보이는 글자가 없다.
    String body = "<@" + pm + "> <@" + lead + ">\u200B ";

    chat(issue, lead, body);

    assertAsking(issue);
    assertThat(chatBodies(issue)).contains(body);
  }

  @Test
  @DisplayName("질문 대기 중 쉼표로 이은 멘션뿐인 사람 글(「@a, @b」·「@a,@b」)은 답이 아니다 — 실행 그대로, 글은 저장")
  void commaSeparatedMentionOnlyReply_doesNotMove() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    // 멘션 사이 구분자가 쉼표(공백 있음·없음)뿐 — 토큰과 그 사이 구분자를 빼면 남는 글자가 없다.
    String spaced = "<@" + pm + ">, <@" + lead + ">";
    String tight = "<@" + pm + ">,<@" + lead + ">,";

    chat(issue, lead, spaced);
    chat(issue, lead, tight);

    assertAsking(issue);
    assertThat(chatBodies(issue)).contains(spaced, tight);
  }

  @Test
  @DisplayName("질문 대기 중 멘션 뒤에 쉼표와 글이 있으면 답이다 — 구분자만 지우고 글은 남긴다")
  void mentionCommaThenText_isAnswer() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);

    chat(issue, lead, "<@" + pm + ">, A 로 해 주세요");

    assertThat(run(issue).get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work");
  }

  @Test
  @DisplayName("멈춘(SUSPENDED) 실행에 단 사람 글은 이동하지 않고 글만 저장한다")
  void suspendedRun_reply_savesMessage_noMove() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, "SUSPENDED")
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .execute();

    chat(issue, lead, "A 로 해 주세요");

    var run = run(issue);
    assertThat(run.get(WORKFLOW_RUN.STATUS)).isEqualTo("SUSPENDED");
    assertThat(run.get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work_ask");
    assertThat(run.get(WORKFLOW_RUN.REVISION)).isEqualTo(1);
    assertThat(chatBodies(issue)).contains("A 로 해 주세요");
  }

  @Test
  @DisplayName("질문 대기가 아닌 사람 노드 대기에 단 챗 글은 이동하지 않는다")
  void notAskingNode_reply_noMove() {
    long bot = agent();
    long issue = startedIssue(bot);
    ok(move(issue, "work", "done", null, 0, "k-done"), pm);

    chat(issue, lead, "확인했어요");

    var run = run(issue);
    assertThat(run.get(WORKFLOW_RUN.STATUS)).isEqualTo("WAITING");
    assertThat(run.get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("check");
    assertThat(run.get(WORKFLOW_RUN.REVISION)).isEqualTo(1);
  }

  @Test
  @DisplayName("답 글에 @AI 멘션이 있어도 AI 는 이동 진입으로 한 번만 깨어난다 — 챗 이벤트에 그 AI 를 싣고 재개 알림은 없다")
  void replyMentioningAgent_wakesOnce() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    events.clear();

    long msg = chat(issue, lead, "<@" + bot + "> A 로 해 주세요");

    assertThat(run(issue).get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work");
    ChatMessageCreatedEvent created =
        events.stream(ChatMessageCreatedEvent.class)
            .filter(e -> e.messageId() == msg)
            .findFirst()
            .orElseThrow();
    assertThat(created.followUpAgentId()).isEqualTo(bot);
    assertThat(events.stream(WorkflowNodeWakeEvent.class)).hasSize(1);
    assertThat(events.stream(AgentsResumedByChatReply.class)).isEmpty();
    IssueHumanReplyPosted replied =
        events.stream(IssueHumanReplyPosted.class).findFirst().orElseThrow();
    assertThat(replied.chatWokenAgentIds()).containsExactly(bot);
  }

  @Test
  @DisplayName("AI 담당이 둘인 노드로 돌아가는 답 글이 둘째 AI 를 멘션해도 그 AI 는 이동 진입으로 한 번만 깨어난다 — 멘션 챗 응답 대행이 없다")
  void replyMentioningSecondAgent_ofMultiAgentNode_wakesOnce() {
    long bot = agent();
    long bot2 = agent();
    // 둘째 AI 는 서버가 실행하는(INTERNAL) AI — 이미 깨운 AI 에서 빠지면 멘션 챗 응답(chat.message.posted)의 대행으로 골린다.
    dsl.update(USER).set(USER.AGENT_RUNTIME, "INTERNAL").where(USER.ID.eq(bot2)).execute();
    String twoBots =
        yaml(bot)
            .replace(
                "bot: { members: [\"" + username(bot) + "\"] }",
                "bot: { members: [\"" + username(bot) + "\", \"" + username(bot2) + "\"] }");
    long wf = publish(twoBots);
    // 시작 노드 담당은 「이슈 담당 ∩ 역할」이라 두 AI 를 이슈 담당으로 넣어야 work 노드 담당이 둘이 된다.
    long issue = issue(lead, bot, bot2);
    ok(startReq(issue, wf), pm);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    events.clear();

    long msg = chat(issue, lead, "<@" + bot2 + "> A 로 해 주세요");

    assertThat(run(issue).get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work");
    // 노드 진입이 두 AI 를 한 번 깨운다.
    List<WorkflowNodeWakeEvent> wakes = events.stream(WorkflowNodeWakeEvent.class).toList();
    assertThat(wakes).hasSize(1);
    assertThat(wakes.getFirst().agentIds()).containsExactlyInAnyOrder(bot, bot2);
    ChatMessageCreatedEvent created =
        events.stream(ChatMessageCreatedEvent.class)
            .filter(e -> e.messageId() == msg)
            .findFirst()
            .orElseThrow();
    assertThat(created.alreadyWokenAgentIds()).containsExactlyInAnyOrder(bot, bot2);
    // dispatcher 와 같은 판정으로 멘션 챗 응답을 대행할 AI 가 없다 — 둘째 AI 가 두 번 시작되지 않는다.
    assertThat(
            ChatAgentWake.actingAgent(
                serverAgentResolver,
                1L,
                created.actor(),
                created.mentions(),
                created.alreadyWokenAgentIds(),
                created.implicitAgentId()))
        .isNull();
    // 대조: 이미 깨운 AI 집합이 없으면 멘션된 둘째 AI 가 대행으로 골린다(이 검증이 헛돌지 않음을 확인).
    assertThat(
            ChatAgentWake.actingAgent(
                serverAgentResolver, 1L, created.actor(), created.mentions(), Set.of(), null))
        .isEqualTo(bot2);
    assertThat(events.stream(AgentsResumedByChatReply.class)).isEmpty();
  }

  @Test
  @DisplayName("배포 전 댓글로 질문하고 기다리던 실행(_qa 에 questionMessageId 없음)도 챗 답으로 answered 이동한다")
  void legacyCommentQuestion_answeredByChat() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    // 옛 댓글 질문의 _qa 모양으로 되돌린다 — 질문 글 id 가 없다.
    dsl.execute(
        "update workflow_run set context = jsonb_set(context, '{_qa,0}',"
            + " (context->'_qa'->0) - 'questionMessageId') where issue_id = ?",
        issue);

    long msg = chat(issue, lead, "B 로 가죠");

    var run = run(issue);
    assertThat(run.get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work");
    JsonNode qa = om.readTree(run.get(WORKFLOW_RUN.CONTEXT).data()).get("_qa").get(0);
    assertThat(qa.has("questionMessageId")).isFalse();
    assertThat(qa.get("question").asString()).isEqualTo(QUESTION);
    assertThat(qa.get("answer").asString()).isEqualTo("B 로 가죠");
    assertThat(qa.get("answerMessageId").asLong()).isEqualTo(msg);
  }

  @Test
  @DisplayName("질문 대기 중 사람의 이슈 댓글은 답이 아니다 — 이동하지 않는다")
  void commentReply_doesNotMove() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);

    var req =
        post(API + "/issues/" + issue + "/comments")
            .content(json("body", "A 로 해 주세요"))
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + jwt.generateAccessToken(lead, "u-" + lead, 1L));
    assertThat(status(req)).isBetween(200, 299);

    assertAsking(issue);
  }

  @Test
  @DisplayName("AI 없는 노드로 돌아가는 답도 소비된다 — 같은 글로 반복 질문 답·암묵 응답 판정을 하지 않고 깨운 AI 도 없다")
  void replyReturningToHumanNode_consumed_noOtherWake() {
    long wf = publish(humanAskYaml());
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    ok(move(issue, "plan", "ask", QUESTION, 0, "k-ask"), lead);
    events.clear();
    // 질문 글 올리기(스레드 조회)가 부른 판정은 빼고 답 글의 판정만 본다.
    clearInvocations(implicitAgents, recurringAnswers);

    long msg = chat(issue, pm, "A 로 가죠");

    var run = run(issue);
    assertThat(run.get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("plan");
    assertThat(run.get(WORKFLOW_RUN.REVISION)).isEqualTo(2);
    verify(recurringAnswers, never()).answer(anyLong(), anyLong(), anyLong(), anyString());
    verify(implicitAgents, never()).resolve(anyLong(), anyLong());
    ChatMessageCreatedEvent created =
        events.stream(ChatMessageCreatedEvent.class)
            .filter(e -> e.messageId() == msg)
            .findFirst()
            .orElseThrow();
    assertThat(created.followUpAgentId()).isNull();
    assertThat(created.implicitAgentId()).isNull();
    assertThat(events.stream(WorkflowNodeWakeEvent.class)).isEmpty();
  }

  @Test
  @DisplayName("답 이동이 끝에서 실패하면 세이브포인트가 이동을 되돌린다 — 챗 POST 는 성공하고 글은 남으며 실행은 질문 대기 그대로")
  void answerMoveFailure_isolatedBySavepoint() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    int nodeRunsBefore = nodeRunCount(issue);
    // 실행 행·노드 방문을 다 쓴 뒤의 마지막 쓰기(멱등 응답 저장)에서 던지게 한다 — 앞선 쓰기가 모두 되돌려지는지 본다.
    doThrow(new IllegalStateException("주입된 실패"))
        .when(runRepository)
        .insertIdempotent(anyLong(), startsWith("chat-answer-"), anyLong(), anyString());

    long msg = chat(issue, lead, "A 로 해 주세요");

    assertAsking(issue);
    assertThat(nodeRunCount(issue)).isEqualTo(nodeRunsBefore);
    assertThat(chatBodies(issue)).contains("A 로 해 주세요");
    JsonNode qa = om.readTree(run(issue).get(WORKFLOW_RUN.CONTEXT).data()).get("_qa").get(0);
    assertThat(qa.has("answer")).isFalse();
    assertThat(msg).isPositive();
  }

  /** 실행의 노드 방문 수. */
  // ───────────────────────── 리뷰 후속: 질문 글 상한·자리표시·빈 의견·미답 판정 ─────────────────────────

  @Test
  @DisplayName("챗 본문 상한(4000자)을 넘는 질문 의견은 422 QUESTION_TOO_LONG 으로 거절하고 아무것도 쓰지 않는다")
  void askMove_tooLongQuestion_rejected() {
    long bot = agent();
    long issue = startedIssue(bot);

    JsonNode body =
        expectAsAgent(move(issue, "work", "ask", "가".repeat(4001), 0, "k-long"), bot, 422);

    assertThat(body.toString()).contains("WORKFLOW_QUESTION_TOO_LONG");
    assertThat(chatBodies(issue)).isEmpty();
    assertThat(run(issue).get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work");
    assertThat(run(issue).get(WORKFLOW_RUN.REVISION)).isZero();
  }

  @Test
  @DisplayName("상한 딱 4000자 질문은 그대로 챗 질문으로 올라간다")
  void askMove_questionAtLimit_posted() {
    long bot = agent();
    long issue = startedIssue(bot);

    expectAsAgent(move(issue, "work", "ask", "가".repeat(4000), 0, "k-limit"), bot);

    assertThat(chatBodies(issue)).containsExactly("가".repeat(4000));
  }

  @Test
  @DisplayName("질문 의견의 스테이징 파일 자리표시는 챗 글 첨부가 되고 본문·_qa 에는 file: 대신 파일 이름이 남는다")
  void askMove_stagedPlaceholder_attachedToChatQuestion() {
    long bot = agent();
    long issue = startedIssue(bot);
    long fileId =
        expectAsAgent(
                post(API + "/staged-files/text").content(json("name", "plan.txt", "content", "내용")),
                bot,
                201)
            .get("fileId")
            .asLong();

    JsonNode moved =
        expectAsAgent(
            move(issue, "work", "ask", "이 안으로 갈까요?\n[계획](file:" + fileId + ")", 0, "k-file"), bot);

    List<String> bodies = chatBodies(issue);
    assertThat(bodies).hasSize(1);
    assertThat(bodies.getFirst()).doesNotContain("file:").contains("**plan.txt** (첨부 파일)");
    long messageId = moved.get("context").get("_qa").get(0).get("questionMessageId").asLong();
    assertThat(
            dsl.select(CHAT_MESSAGE_ATTACHMENT.FILE_ID)
                .from(CHAT_MESSAGE_ATTACHMENT)
                .where(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID.eq(messageId))
                .fetch(CHAT_MESSAGE_ATTACHMENT.FILE_ID))
        .containsExactly(fileId);
    assertThat(moved.get("context").get("_qa").get(0).get("question").asString())
        .isEqualTo(bodies.getFirst());
  }

  @Test
  @DisplayName("보이지 않는 글자뿐인 질문 의견은 챗 글을 올리지 않고(챗 빈 글 거절로 실패하지 않고) 이동만 한다")
  void askMove_invisibleOnlyComment_noChatPost() {
    long bot = agent();
    long wf =
        publish(
            yaml(bot)
                .replace(
                    "ask: { to: work_ask, assignTo: lead, requireComment: true }",
                    "ask: { to: work_ask, assignTo: lead }"));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);

    JsonNode moved = expectAsAgent(move(issue, "work", "ask", "​​", 0, "k-zw"), bot);

    assertThat(chatBodies(issue)).isEmpty();
    assertThat(run(issue).get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work_ask");
    JsonNode qa = moved.get("context").get("_qa").get(0);
    assertThat(qa.has("question")).isFalse();
    assertThat(qa.has("questionMessageId")).isFalse();
  }

  @Test
  @DisplayName("_qa 항목의 answer 가 JSON null 이어도 미답으로 보고 챗 답이 그 항목을 채운다")
  void nullAnswerEntry_treatedAsUnanswered() {
    long bot = agent();
    long issue = startedIssue(bot);
    expectAsAgent(move(issue, "work", "ask", QUESTION, 0, "k-ask"), bot);
    // 다른 경로(옛 데이터·수동 조치)로 answer 칸이 null 로 들어간 미답 항목.
    dsl.execute(
        "update workflow_run set context = jsonb_set(context, '{_qa,0,answer}', 'null'::jsonb)"
            + " where issue_id = ?",
        issue);

    long msg = chat(issue, lead, "B 로 해 주세요");

    var run = run(issue);
    assertThat(run.get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work");
    JsonNode qa = om.readTree(run.get(WORKFLOW_RUN.CONTEXT).data()).get("_qa").get(0);
    assertThat(qa.get("answer").asString()).isEqualTo("B 로 해 주세요");
    assertThat(qa.get("answerMessageId").asLong()).isEqualTo(msg);
  }

  private int nodeRunCount(long issue) {
    return dsl.fetchCount(
        NODE_RUN,
        NODE_RUN.RUN_ID.in(
            dsl.select(WORKFLOW_RUN.ID).from(WORKFLOW_RUN).where(WORKFLOW_RUN.ISSUE_ID.eq(issue))));
  }

  /** 사람 노드 plan 에서 ask 로 묻고 plan 으로 돌아오는 정의 — 돌아갈 노드에 AI 가 없다. */
  private String humanAskYaml() {
    return """
    schema: genia/workflow@1
    name: 사람 질문
    roles:
      lead: { members: ["%s"] }
    nodes:
      start: { type: start }
      route: { type: decision, default: plan }
      plan:
        type: human_task
        role: lead
        outcomes:
          ok: { to: end }
          ask: { to: plan_ask, assignTo: lead, requireComment: true }
      plan_ask:
        type: human_task
        role: lead
        returnTo: plan
        outcomes:
          answered: { to: plan, assignTo: keep, requireComment: true }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: route }
    """
        .formatted(username(lead));
  }

  /** 실행이 질문 대기 그대로인지 — 지금 노드 work_ask·WAITING·revision 1. */
  private void assertAsking(long issue) {
    var run = run(issue);
    assertThat(run.get(WORKFLOW_RUN.STATUS)).isEqualTo("WAITING");
    assertThat(run.get(WORKFLOW_RUN.CURRENT_NODE)).isEqualTo("work_ask");
    assertThat(run.get(WORKFLOW_RUN.REVISION)).isEqualTo(1);
  }

  /** 사람이 화면과 같은 API 로 이슈 챗에 글을 쓰고 그 글 id 를 돌려준다. */
  private long chat(long issue, long as, String body) {
    return expect(
            post(API + "/chat/threads/" + threadOf(issue) + "/messages")
                .content(json("body", body)),
            as,
            201)
        .get("id")
        .asLong();
  }

  private long threadOf(long issue) {
    long id = chatThreadRepository.insertIfAbsent(issue);
    TenantContext.set(1L);
    return id;
  }

  private org.jooq.Record run(long issue) {
    return dsl.selectFrom(WORKFLOW_RUN).where(WORKFLOW_RUN.ISSUE_ID.eq(issue)).fetchSingle();
  }

  private int number(long issue) {
    return dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(issue)).fetchSingle().value1();
  }

  /** (이슈, 작업자)의 진행 중 작업 상태. */
  private List<String> activeStates(long issue, long worker) {
    return dsl.select(AGENT_WORK.STATE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issue))
        .and(AGENT_WORK.WORKER_ID.eq(worker))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .fetch(AGENT_WORK.STATE);
  }

  /** 이슈 챗 글 본문(작성 순). */
  private List<String> chatBodies(long issue) {
    return dsl.select(CHAT_MESSAGE.BODY)
        .from(CHAT_MESSAGE)
        .join(CHAT_THREAD)
        .on(CHAT_THREAD.ID.eq(CHAT_MESSAGE.THREAD_ID))
        .where(CHAT_THREAD.ISSUE_ID.eq(issue))
        .orderBy(CHAT_MESSAGE.ID)
        .fetch(CHAT_MESSAGE.BODY);
  }

  /** 마지막 이동 이벤트의 override 표시. */
  private boolean lastMovedOverride(long issue) {
    String payload =
        dsl.select(WORKFLOW_RUN_EVENT.PAYLOAD)
            .from(WORKFLOW_RUN_EVENT)
            .join(WORKFLOW_RUN)
            .on(WORKFLOW_RUN.ID.eq(WORKFLOW_RUN_EVENT.RUN_ID))
            .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
            .and(WORKFLOW_RUN_EVENT.TYPE.eq("MOVED"))
            .orderBy(WORKFLOW_RUN_EVENT.ID.desc())
            .limit(1)
            .fetchSingle()
            .value1()
            .data();
    return om.readTree(payload).get("override").asBoolean();
  }

  /** 요청을 보내고 응답 상태만 돌려준다. */
  private int status(MockHttpServletRequestBuilder req) {
    try {
      return mvc.perform(req).andReturn().getResponse().getStatus();
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }

  private Long nodeRunCommentId(long issue, String nodeKey) {
    return dsl.select(NODE_RUN.COMMENT_ID)
        .from(NODE_RUN)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(NODE_RUN.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .and(NODE_RUN.NODE_KEY.eq(nodeKey))
        .orderBy(NODE_RUN.ID.desc())
        .limit(1)
        .fetchSingle(NODE_RUN.COMMENT_ID);
  }

  /** lead 가 담당인 이슈에 정의를 시작해 bot 이 맡는 work(agent_task)에 머물게 한 이슈 id. */
  private long startedIssue(long bot) {
    long wf = publish(yaml(bot));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    return issue;
  }

  /** work → work_ask(ask/answered) 와 check 를 가진 정의 — lead 가 담당이면 decision 을 거쳐 bot 의 work 로 간다. */
  private String yaml(long bot) {
    return """
    schema: genia/workflow@1
    name: 질문
    roles:
      lead: { members: ["%s"] }
      bot: { members: ["%s"] }
    nodes:
      start: { type: start }
      route: { type: decision, default: work }
      work:
        type: agent_task
        role: bot
        instructions: 작업
        outcomes:
          done: { to: check, assignTo: lead }
          ask: { to: work_ask, assignTo: lead, requireComment: true }
      work_ask:
        type: human_task
        role: lead
        returnTo: work
        outcomes:
          answered: { to: work, assignTo: keep, requireComment: true }
      check: { type: human_task, role: lead, outcomes: { ok: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: route }
    """
        .formatted(username(lead), username(bot));
  }

  /** 프로젝트 구성원 외부 AI — 직접 이동하려면 USER 역할이 필요하다. */
  private long agent() {
    long id = withMembership(TestFixtures.createAgentNoToken(dsl));
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(id)).execute();
    projectMemberRepository.insert(projectId, id, "MEMBER");
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  /** 이 프로젝트에 게시하고 켠 정의 id. */
  private long publish(String yaml) {
    JsonNode created =
        expect(
            post(API + "/projects/" + projectId + "/workflows")
                .content(json("name", "흐름 " + UUID.randomUUID(), "yaml", yaml)),
            pm,
            201);
    long id = created.get("id").asLong();
    expect(post(API + "/workflows/" + id + "/publish"), pm, 200);
    ok(patch(API + "/workflows/" + id).content(json("enabled", true)), pm);
    return id;
  }

  /** 관리자가 담당을 넣어 만든 이슈 id. */
  private long issue(long... assignees) {
    List<Long> ids = new ArrayList<>();
    for (long a : assignees) {
      ids.add(a);
    }
    JsonNode body =
        expect(
            post(API + "/projects/" + key + "/issues")
                .content(json("title", "이슈", "assigneeIds", ids)),
            pm,
            200);
    return body.get("id").asLong();
  }

  private MockHttpServletRequestBuilder startReq(long issue, long wf) {
    return post(API + "/issues/" + issue + "/workflow/start")
        .content(json("workflowId", wf, "dryRun", false));
  }

  private MockHttpServletRequestBuilder move(
      long issue, String from, String outcome, String comment, int revision, String idemKey) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("fromNode", from);
    body.put("outcome", outcome);
    if (comment != null) body.put("comment", comment);
    body.put("expectedRevision", revision);
    body.put("idempotencyKey", idemKey);
    return post(API + "/issues/" + issue + "/workflow/move").content(om.writeValueAsString(body));
  }

  /** AI 의 ak_ 키(+ 도구 맥락 헤더)로 요청하고 200 응답 본문을 돌려준다 — 외부 AI 가 직접 이동하는 경로. */
  private JsonNode expectAsAgent(MockHttpServletRequestBuilder req, long worker) {
    return expectAsAgent(req, worker, 200);
  }

  /** AI 의 ak_ 키로 요청하고 기대한 상태의 응답 본문을 돌려준다(본문이 없으면 null). */
  private JsonNode expectAsAgent(MockHttpServletRequestBuilder req, long worker, int status) {
    String token = agentKeyService.issue(pm, worker, new IssueAgentKeyRequest("wf")).plaintextKey();
    req.contentType(MediaType.APPLICATION_JSON)
        .header("Authorization", "Bearer " + token)
        .header(AgentToolContext.HEADER, "claude-code");
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      assertThat(response.getStatus()).as("%s", text).isEqualTo(status);
      return text.isBlank() ? null : om.readTree(text);
    } catch (Exception e) {
      throw new IllegalStateException("AI 요청 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }

  private String json(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      map.put((String) pairs[i], pairs[i + 1]);
    }
    return om.writeValueAsString(map);
  }

  private JsonNode ok(MockHttpServletRequestBuilder req, long caller) {
    return expect(req, caller, 200);
  }

  private JsonNode expect(MockHttpServletRequestBuilder req, long caller, int status) {
    req.contentType(MediaType.APPLICATION_JSON);
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L));
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      assertThat(response.getStatus()).as("%s", text).isEqualTo(status);
      return text.isBlank() ? null : om.readTree(text);
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }
}
