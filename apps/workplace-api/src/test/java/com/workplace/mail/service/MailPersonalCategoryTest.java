package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.ai.AiMemoryReader;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalRequest;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalResult;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1341 ④ 개인 비서 분류 — 개인 비서이고 메일 범위 기억이 하나라도 있을 때만(WP-1346) 그 기억을 실어 개인 분류를 받아
 * 사본(ai_personal_category)에 저장하고, 직접 바꾼 분류는 건드리지 않는다. 메모리 리더는 늘 새 트랜잭션에서 읽어 테스트 트랜잭션의 시드를 못 보므로 목으로
 * 바꾼다(메일 분류 학습 테스트와 같은 목 조합).
 */
@Transactional
class MailPersonalCategoryTest extends ExternalClientMockedTestBase {

  private static final AssistantSpec PERSONAL =
      new AssistantSpec(9L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);
  private static final AssistantSpec WORKSPACE =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);
  private static final AiMemoryLine RULE =
      new AiMemoryLine(7L, "PREFERENCE", "원티드 뉴스레터는 뉴스레터로 분류", "MAIL", null, null);

  @MockitoBean AiMemoryReader memoryReader;

  @Autowired MailAnalysisService analysis;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;
  @Autowired AiAgentMailClient mailClient;
  @Autowired AssistantResolver assistantResolver;

  @BeforeEach
  void personalAssistant() {
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(PERSONAL));
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(PERSONAL));
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(WORKSPACE));
    when(memoryReader.readAppScope(anyLong(), anyString())).thenReturn(List.of(RULE));
  }

  private long seed(Box box, String subject, String sharedCategory) {
    return seed(box, subject, sharedCategory, "news@wanted.co.kr");
  }

  /** 보낸 사람 주소를 정해 심는다 — box.address() 면 사내 구성원 발신이다. */
  private long seed(Box box, String subject, String sharedCategory, String from) {
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.SUBJECT, subject)
        .set(EMAIL_CONTENT.AI_CATEGORY, sharedCategory)
        .where(EMAIL_CONTENT.ID.eq(content))
        .execute();
    return MailAnalysisFixtures.envelope(dsl, box, content, from, box.address(), null);
  }

  private String personalCategory(long env) {
    return dsl.select(EMAIL_MESSAGE.AI_PERSONAL_CATEGORY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .fetchOne(EMAIL_MESSAGE.AI_PERSONAL_CATEGORY);
  }

  private String userCategory(long env) {
    return dsl.select(EMAIL_MESSAGE.USER_CATEGORY)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(env))
        .fetchOne(EMAIL_MESSAGE.USER_CATEGORY);
  }

  private AnalyzePersonalRequest captured() {
    ArgumentCaptor<AnalyzePersonalRequest> req =
        ArgumentCaptor.forClass(AnalyzePersonalRequest.class);
    verify(mailClient).analyzePersonal(req.capture());
    return req.getValue();
  }

  private static AnalyzePersonalResult result(String personalCategory) {
    return new AnalyzePersonalResult(false, null, false, null, personalCategory);
  }

  /** 개인 비서면 개인 분류를 요청하고, 받은 분류를 내 사본에 저장한다(공용 분류는 그대로). */
  @Test
  void personalAnalysis_savesPersonalCategory_whenPersonalAssistant() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = seed(box, "원티드 주간 소식", "업무");
    when(mailClient.analyzePersonal(any())).thenReturn(result("뉴스레터"));

    analysis.analyzePersonal(box.userId(), env, analysis.newProfileCache());

    assertThat(captured().includePersonalCategory()).isTrue();
    assertThat(personalCategory(env)).isEqualTo("뉴스레터");
    assertThat(
            dsl.select(EMAIL_CONTENT.AI_CATEGORY)
                .from(EMAIL_CONTENT)
                .join(EMAIL_MESSAGE)
                .on(EMAIL_MESSAGE.CONTENT_ID.eq(EMAIL_CONTENT.ID))
                .where(EMAIL_MESSAGE.ID.eq(env))
                .fetchOne(EMAIL_CONTENT.AI_CATEGORY))
        .isEqualTo("업무");
  }

  /** 개인 비서 요청에는 메일 범위 기억만(질의·순위 없이) 싣는다. */
  @Test
  void personalAnalysis_sendsMailMemories() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = seed(box, "원티드 주간 소식", "업무");
    when(mailClient.analyzePersonal(any())).thenReturn(result(null));

    analysis.analyzePersonal(box.userId(), env, analysis.newProfileCache());

    assertThat(captured().memories()).containsExactly(RULE);
    verify(memoryReader).readAppScope(box.userId(), AiMemoryReader.MAIL);
    verify(memoryReader, never()).readForEntry(anyLong(), anyString(), any());
  }

  /** 공용 비서만 있으면 개인 분류를 요청하지도, 기억을 읽지도 않는다(공용 비서는 메모리가 없다). */
  @Test
  void personalAnalysis_skipsPersonalCategory_whenOnlyWorkspaceAssistant() {
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(WORKSPACE));
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.empty());
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = seed(box, "원티드 주간 소식", "업무");
    when(mailClient.analyzePersonal(any())).thenReturn(result("뉴스레터"));

    analysis.analyzePersonal(box.userId(), env, analysis.newProfileCache());

    AnalyzePersonalRequest req = captured();
    assertThat(req.includePersonalCategory()).isNotEqualTo(Boolean.TRUE);
    assertThat(req.memories()).isNull();
    verify(memoryReader, never()).readAppScope(anyLong(), eq(AiMemoryReader.MAIL));
    assertThat(personalCategory(env)).isNull();
  }

  /**
   * WP-1346 메일 범위 기억이 없으면 개인 비서여도 개인 분류를 묻지 않고(기억도 싣지 않음) 응답에 개인 분류가 와도 저장하지 않는다 — 기억이 없으면 개인 분류는
   * 공용 분류와 같아 저장할 이유가 없다.
   */
  @Test
  void personalAnalysis_skipsPersonalCategory_whenNoMailMemories() {
    when(memoryReader.readAppScope(anyLong(), anyString())).thenReturn(List.of());
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = seed(box, "원티드 주간 소식", "업무");
    when(mailClient.analyzePersonal(any())).thenReturn(result("뉴스레터"));

    analysis.analyzePersonal(box.userId(), env, analysis.newProfileCache());

    AnalyzePersonalRequest req = captured();
    assertThat(req.includePersonalCategory()).isNotEqualTo(Boolean.TRUE);
    assertThat(req.memories()).isNull();
    assertThat(personalCategory(env)).isNull();
  }

  /** 직접 바꾼 분류가 있는 메일을 ④ 가 분석해도 직접 분류는 그대로다(Review Focus 2). */
  @Test
  void personalAnalysis_keepsUserCategory_whenUserAlreadySetIt() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = seed(box, "원티드 주간 소식", "업무");
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.USER_CATEGORY, "개인")
        .where(EMAIL_MESSAGE.ID.eq(env))
        .execute();
    when(mailClient.analyzePersonal(any())).thenReturn(result("뉴스레터"));

    analysis.analyzePersonal(box.userId(), env, analysis.newProfileCache());

    assertThat(userCategory(env)).isEqualTo("개인");
    assertThat(personalCategory(env)).isEqualTo("뉴스레터");
    assertThat(analysis.readContext(box.userId(), env).category()) // 유효 분류는 직접 분류
        .isEqualTo("개인");
  }

  /** 개인 비서 분류에도 광고 보정을 적용한다 — 「(광고)」 제목인데 업무라고 하면 프로모션. */
  @Test
  void personalAnalysis_appliesAdRuleToPersonalCategory() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = seed(box, "(광고) 우리가 [일하는 사이]", "프로모션");
    when(mailClient.analyzePersonal(any())).thenReturn(result("업무"));

    analysis.analyzePersonal(box.userId(), env, analysis.newProfileCache());

    assertThat(personalCategory(env)).isEqualTo("프로모션");
  }

  /**
   * 사내 구성원이 보낸 메일이라도 개인 비서 분류 뉴스레터는 그대로다 — 사내 구성원→업무 규칙은 공용 분류에만 쓴다. 개인 분류는 사용자 기억(사내 주간 소식을
   * 뉴스레터로)을 반영한 결과라 덮으면 학습이 무의미해진다.
   */
  @Test
  void personalAnalysis_keepsPersonalNewsletter_whenMemberSender() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    TestFixtures.activeMemberOfCurrentTenant(dsl, box.userId());
    long env = seed(box, "사내 주간 소식", "업무", box.address());
    when(mailClient.analyzePersonal(any())).thenReturn(result("뉴스레터"));

    analysis.analyzePersonal(box.userId(), env, analysis.newProfileCache());

    assertThat(personalCategory(env)).isEqualTo("뉴스레터");
  }
}
