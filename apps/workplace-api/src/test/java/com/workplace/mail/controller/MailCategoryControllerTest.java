package com.workplace.mail.controller;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.ai.AiMemoryReader;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.service.AiMemoryService;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.LearnCategoryRequest;
import com.workplace.mail.outbound.MailAiMessages.LearnCategoryResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1341 메일 분류 직접 바꾸기(PUT /messages/{id}/category)와 교정 학습(POST /messages/{id}/category/learn).
 *
 * <p>메모리 리더는 늘 새 트랜잭션에서 읽어 테스트 트랜잭션의 시드를 못 보므로 목으로 바꾼다(MailPersonalCategoryTest 와 같은 목 조합 — 컨텍스트를
 * 함께 쓴다). 메모리 저장은 실제 서비스로 해서 DB 행을 확인한다.
 */
@Transactional
class MailCategoryControllerTest extends ExternalClientMockedTestBase {

  private static final AssistantSpec PERSONAL =
      new AssistantSpec(9L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);

  @MockitoBean AiMemoryReader memoryReader;

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired EmailContentRepository contentRepo;
  @Autowired AiAgentMailClient mailClient;
  @Autowired AssistantResolver assistantResolver;
  @Autowired AiMemoryService memoryService;

  @BeforeEach
  void personalAssistant() {
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(PERSONAL));
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(PERSONAL));
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());
    when(memoryReader.readAppScope(anyLong(), anyString())).thenReturn(List.of());
  }

  private String token(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  /** AI 를 켠 계정의 메일 한 통(공용 분류 sharedCategory). */
  private long mail(Box box, String sharedCategory) {
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.SUBJECT, "원티드 주간 소식")
        .set(EMAIL_CONTENT.AI_CATEGORY, sharedCategory)
        .where(EMAIL_CONTENT.ID.eq(content))
        .execute();
    return MailAnalysisFixtures.envelope(
        dsl, box, content, "minsu@wanted.co.kr", box.address(), null);
  }

  private ResultActions setCategory(long userId, long messageId, String categoryJson)
      throws Exception {
    return mvc.perform(
        put("/api/v1/mail/messages/{id}/category", messageId)
            .header("Authorization", token(userId))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"category\":" + categoryJson + "}"));
  }

  private ResultActions learn(long userId, long messageId, String from, String to)
      throws Exception {
    return mvc.perform(
        post("/api/v1/mail/messages/{id}/category/learn", messageId)
            .header("Authorization", token(userId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(
                "{\"fromCategory\":"
                    + (from == null ? "null" : "\"" + from + "\"")
                    + ",\"toCategory\":\""
                    + to
                    + "\"}"));
  }

  private String userCategory(long messageId) {
    return dsl.select(EMAIL_MESSAGE.USER_CATEGORY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .fetchOne(EMAIL_MESSAGE.USER_CATEGORY);
  }

  private Boolean needsReply(long messageId) {
    return dsl.select(EMAIL_MESSAGE.AI_NEEDS_REPLY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .fetchOne(EMAIL_MESSAGE.AI_NEEDS_REPLY);
  }

  /** 직접 바꾼 분류를 사본에 저장하고 유효 분류·「내가 정한 분류」·학습 가능 여부를 돌려준다. */
  @Test
  void setCategory_savesUserCategory_andReturnsEffective() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");

    setCategory(box.userId(), m, "\"뉴스레터\"")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.aiCategory").value("뉴스레터"))
        .andExpect(jsonPath("$.categoryByMe").value(true))
        .andExpect(jsonPath("$.learnable").value(true));

    assertThat(userCategory(m)).isEqualTo("뉴스레터");
    // 같은 분류로 다시 바꾸면 학습할 것이 없다(이전 유효 분류와 같음)
    setCategory(box.userId(), m, "\"뉴스레터\"")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.learnable").value(false));
  }

  /** null 이면 직접 분류를 지워 AI 분류로 되돌린다(학습 대상 아님). */
  @Test
  void setCategory_clearsUserCategory_whenNull() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");
    setCategory(box.userId(), m, "\"뉴스레터\"").andExpect(status().isOk());

    setCategory(box.userId(), m, "null")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.aiCategory").value("업무"))
        .andExpect(jsonPath("$.categoryByMe").value(false))
        .andExpect(jsonPath("$.learnable").value(false));

    assertThat(userCategory(m)).isNull();
  }

  /** 5종 밖 분류는 400. */
  @Test
  void setCategory_returns400_whenUnknownCategory() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");

    setCategory(box.userId(), m, "\"기타\"").andExpect(status().isBadRequest());

    assertThat(userCategory(m)).isNull();
  }

  /** 남의 메일은 404 — 분류를 바꾸지 않는다. */
  @Test
  void setCategory_returns404_whenOthersMail() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");
    long other = TestFixtures.createHuman(dsl);

    setCategory(other, m, "\"뉴스레터\"").andExpect(status().isNotFound());
    learn(other, m, "업무", "뉴스레터").andExpect(status().isNotFound());

    assertThat(userCategory(m)).isNull();
  }

  /** 업무 → 뉴스레터로 바꾸면 ⑤ 를 다시 계산해 회신필요가 차단되고, 되돌리면 다시 회신필요다. */
  @Test
  void setCategory_recomputesNeedsReply() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");
    MailAnalysisFixtures.markPersonallyAnalyzed(dsl, m, true);
    assertThat(needsReply(m)).isTrue();

    setCategory(box.userId(), m, "\"뉴스레터\"").andExpect(status().isOk());
    assertThat(needsReply(m)).isFalse();

    setCategory(box.userId(), m, "null").andExpect(status().isOk());
    assertThat(needsReply(m)).isTrue();
  }

  /** ai-agent 가 CREATE 면 메일 범위·선호·출처 AI 기억을 만들고 그 id·문장을 돌려준다. */
  @Test
  void learn_createsMailMemory_whenAgentSaysCreate() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");
    String rule = "원티드(wantedlab.com) 채용 소식 메일은 업무가 아니라 프로모션으로 분류";
    when(mailClient.learnCategory(any())).thenReturn(new LearnCategoryResult("CREATE", null, rule));
    setCategory(box.userId(), m, "\"프로모션\"").andExpect(status().isOk());

    learn(box.userId(), m, "업무", "프로모션")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.action").value("CREATE"))
        .andExpect(jsonPath("$.memoryId").isNumber())
        .andExpect(jsonPath("$.content").value(rule));

    Record row =
        dsl.select(AI_MEMORY.KIND, AI_MEMORY.SCOPE, AI_MEMORY.SOURCE, AI_MEMORY.CONTENT)
            .from(AI_MEMORY)
            .where(AI_MEMORY.USER_ID.eq(box.userId()))
            .fetchOne();
    assertThat(row.get(AI_MEMORY.KIND)).isEqualTo("PREFERENCE");
    assertThat(row.get(AI_MEMORY.SCOPE)).isEqualTo("MAIL");
    assertThat(row.get(AI_MEMORY.SOURCE)).isEqualTo("AI");
    assertThat(row.get(AI_MEMORY.CONTENT)).isEqualTo(rule);

    ArgumentCaptor<LearnCategoryRequest> req = ArgumentCaptor.forClass(LearnCategoryRequest.class);
    verify(mailClient).learnCategory(req.capture());
    assertThat(req.getValue().fromCategory()).isEqualTo("업무");
    assertThat(req.getValue().toCategory()).isEqualTo("프로모션");
    assertThat(req.getValue().subject()).isEqualTo("원티드 주간 소식");
    assertThat(req.getValue().assistantAgentId()).isEqualTo(PERSONAL.agentUserId());
  }

  /** ai-agent 가 UPDATE 면 그 기억 문장을 고치고 이전 문장을 돌려준다(웹 [기억 취소]가 되돌릴 값). */
  @Test
  void learn_updatesMemory_whenAgentSaysUpdate() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");
    AiMemoryItem old =
        memoryService.create(
            box.userId(),
            new CreateAiMemoryRequest("PREFERENCE", "원티드 메일은 업무로 분류", null, null, "MAIL", null),
            false);
    when(memoryReader.readAppScope(anyLong(), anyString()))
        .thenReturn(
            List.of(new AiMemoryLine(old.id(), "PREFERENCE", old.content(), "MAIL", null, null)));
    String updated = "원티드 채용 소식 메일은 프로모션으로 분류";
    when(mailClient.learnCategory(any()))
        .thenReturn(new LearnCategoryResult("UPDATE", old.id(), updated));
    setCategory(box.userId(), m, "\"프로모션\"").andExpect(status().isOk());

    learn(box.userId(), m, "업무", "프로모션")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.action").value("UPDATE"))
        .andExpect(jsonPath("$.memoryId").value(old.id()))
        .andExpect(jsonPath("$.content").value(updated))
        .andExpect(jsonPath("$.previousContent").value("원티드 메일은 업무로 분류"));

    assertThat(
            dsl.select(AI_MEMORY.CONTENT)
                .from(AI_MEMORY)
                .where(AI_MEMORY.ID.eq(old.id()))
                .fetchOne(AI_MEMORY.CONTENT))
        .isEqualTo(updated);
    ArgumentCaptor<LearnCategoryRequest> req = ArgumentCaptor.forClass(LearnCategoryRequest.class);
    verify(mailClient).learnCategory(req.capture());
    assertThat(req.getValue().memories())
        .extracting(LearnCategoryRequest.Memory::id)
        .containsExactly(old.id());
  }

  /** 개인 비서가 없거나 AI 기억을 끈 계정은 학습하지 않고 204(Review Focus 5). */
  @Test
  void learn_returns204_whenNoPersonalAssistantOrMemoryOff() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");

    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.empty());
    setCategory(box.userId(), m, "\"프로모션\"")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.learnable").value(false));
    learn(box.userId(), m, "업무", "프로모션").andExpect(status().isNoContent());

    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(PERSONAL));
    dsl.update(USER).set(USER.AI_MEMORY_ENABLED, false).where(USER.ID.eq(box.userId())).execute();
    learn(box.userId(), m, "업무", "프로모션").andExpect(status().isNoContent());

    verify(mailClient, never()).learnCategory(any());
    assertThat(dsl.fetchCount(AI_MEMORY, AI_MEMORY.USER_ID.eq(box.userId()))).isZero();
  }

  /** 학습 호출이 실패해도(구 ai-agent 404·모델 출력 오류 502 등) NONE 으로 끝나고 바꾼 분류는 그대로다(Review Focus 4). */
  @Test
  void learn_returnsNone_whenAgentFails() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");
    setCategory(box.userId(), m, "\"프로모션\"").andExpect(status().isOk());
    when(mailClient.learnCategory(any()))
        .thenThrow(new MailAiException("AI 요청에 실패했어요.", new RuntimeException("404")));

    learn(box.userId(), m, "업무", "프로모션")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.action").value("NONE"))
        .andExpect(jsonPath("$.memoryId").value(nullValue()));

    assertThat(userCategory(m)).isEqualTo("프로모션");
    assertThat(dsl.fetchCount(AI_MEMORY, AI_MEMORY.USER_ID.eq(box.userId()))).isZero();
  }

  /**
   * 학습 입력에는 메일 범위 기억만 싣는다 — 공통 범위 기억(다른 앱에도 쓰이는 일반 기억)을 모델이 UPDATE 로 덮지 못하게. 공통 기억 id 로 UPDATE 하면
   * NONE 이고 그 기억은 그대로다.
   */
  @Test
  void learn_sendsOnlyMailMemories_andIgnoresUpdateOfCommonMemory() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");
    AiMemoryItem common =
        memoryService.create(
            box.userId(),
            new CreateAiMemoryRequest("PREFERENCE", "답장은 존댓말로", null, null, null, null),
            false);
    AiMemoryItem mailRule =
        memoryService.create(
            box.userId(),
            new CreateAiMemoryRequest("PREFERENCE", "원티드 메일은 업무로 분류", null, null, "MAIL", null),
            false);
    // 리더는 메일 범위만 돌려준다(readAppScope — 공통 기억은 싣지 않는다)
    when(memoryReader.readAppScope(anyLong(), anyString()))
        .thenReturn(
            List.of(
                new AiMemoryLine(
                    mailRule.id(), "PREFERENCE", mailRule.content(), "MAIL", null, null)));
    when(mailClient.learnCategory(any()))
        .thenReturn(new LearnCategoryResult("UPDATE", common.id(), "답장은 반말로"));
    setCategory(box.userId(), m, "\"프로모션\"").andExpect(status().isOk());

    learn(box.userId(), m, "업무", "프로모션")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.action").value("NONE"));

    ArgumentCaptor<LearnCategoryRequest> req = ArgumentCaptor.forClass(LearnCategoryRequest.class);
    verify(mailClient).learnCategory(req.capture());
    assertThat(req.getValue().memories())
        .extracting(LearnCategoryRequest.Memory::id)
        .containsExactly(mailRule.id());
    assertThat(
            dsl.select(AI_MEMORY.CONTENT)
                .from(AI_MEMORY)
                .where(AI_MEMORY.ID.eq(common.id()))
                .fetchOne(AI_MEMORY.CONTENT))
        .isEqualTo("답장은 존댓말로");
  }

  /**
   * 클라이언트가 보낸 from·to 를 믿지 않는다 — 내가 직접 정한 분류가 없거나 그 분류가 toCategory 와 다르면 학습하지 않고 204. (실제로 바꾸지 않은
   * 교정을 학습 요청만으로 기억에 남기지 못하게.)
   */
  @Test
  void learn_returns204_whenUserCategoryNotSetOrDifferent() throws Exception {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long m = mail(box, "업무");
    when(mailClient.learnCategory(any()))
        .thenReturn(new LearnCategoryResult("CREATE", null, "원티드 메일은 프로모션"));

    learn(box.userId(), m, "업무", "프로모션").andExpect(status().isNoContent());

    setCategory(box.userId(), m, "\"뉴스레터\"").andExpect(status().isOk());
    learn(box.userId(), m, "업무", "프로모션").andExpect(status().isNoContent());

    verify(mailClient, never()).learnCategory(any());
    assertThat(dsl.fetchCount(AI_MEMORY, AI_MEMORY.USER_ID.eq(box.userId()))).isZero();
  }
}
