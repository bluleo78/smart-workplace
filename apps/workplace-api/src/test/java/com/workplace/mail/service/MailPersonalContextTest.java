package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.mail.service.MailAnalysisFixtures.LONG_BODY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalRequest;
import com.workplace.mail.outbound.MailAiMessages.AnalyzePersonalResult;
import com.workplace.mail.outbound.MailAiMessages.Sender;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.service.MailAnalysisFixtures.Box;
import com.workplace.support.IntegrationTestBase;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;

/** WP-150 ④ 보강 입력 배선 — 관계 블록 전달, 블록 조회 실패 시 그 블록만 빠지고 분석 계속, 요약만 모드도 같은 입력. */
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class MailPersonalContextTest extends IntegrationTestBase {

  private static final AssistantSpec SPEC =
      new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);

  @Autowired MailAnalysisService analysis;
  @Autowired DSLContext dsl;
  @Autowired EmailContentRepository contentRepo;

  @MockitoBean AiAgentMailClient mailClient;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoSpyBean SenderRelationResolver relationResolver;

  @BeforeEach
  void assistants() {
    // 공통 비서 있음(④ 는 분류를 요청하지 않음), 개인 비서 없음
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.empty());
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(SPEC));
  }

  private AnalyzePersonalRequest captured() {
    ArgumentCaptor<AnalyzePersonalRequest> req =
        ArgumentCaptor.forClass(AnalyzePersonalRequest.class);
    verify(mailClient).analyzePersonal(req.capture());
    return req.getValue();
  }

  private long envelopeFrom(Box box, String from) {
    long content = MailAnalysisFixtures.content(dsl, contentRepo, LONG_BODY, "미리보기");
    return MailAnalysisFixtures.envelope(dsl, box, content, from, box.address(), null);
  }

  @Test
  void senderRelation_sentToAgent() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long n = System.nanoTime();
    long kim = MailPeopleFixtures.member(dsl, 1L, "minsu-" + n + "@acme.com", "김민수", "팀장");
    String dev = "개발팀-" + n;
    MailPeopleFixtures.sharedGroup(dsl, dev, box.userId(), kim);
    MailPeopleFixtures.favorite(dsl, box.userId(), "MEMBER", kim);
    long env = envelopeFrom(box, "minsu-" + n + "@acme.com");
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, null));

    analysis.analyzePersonal(box.userId(), env);

    Sender s = captured().sender();
    assertThat(s.relation()).isEqualTo("MEMBER");
    assertThat(s.name()).isEqualTo("김민수");
    assertThat(s.title()).isEqualTo("팀장");
    assertThat(s.sameGroups()).containsExactly(dev);
    assertThat(s.favorite()).isTrue();
  }

  @Test
  void relationFailure_dropsOnlySenderBlock() {
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    MailPeopleFixtures.setProfile(dsl, box.userId(), "홍길동", "팀장");
    long env = envelopeFrom(box, "minsu@acme.com");
    doThrow(new RuntimeException("boom")).when(relationResolver).resolve(any(), any());
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(true, null, false, null));

    analysis.analyzePersonal(box.userId(), env);

    AnalyzePersonalRequest req = captured();
    assertThat(req.sender()).isNull();
    assertThat(req.me().name()).isEqualTo("홍길동");
    Boolean raw =
        dsl.select(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(env))
            .fetchOneInto(Boolean.class);
    assertThat(raw).isTrue(); // 분석은 계속돼 저장됨
  }

  @Test
  void personalSummaryOnly_alsoCarriesContext() {
    when(assistantResolver.resolvePersonalOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
    Box box = MailAnalysisFixtures.mailbox(dsl, true);
    long env = envelopeFrom(box, "stranger@nowhere.example");
    when(mailClient.analyzePersonal(any()))
        .thenReturn(new AnalyzePersonalResult(null, "• 핵심: 요약", true, null));

    analysis.generatePersonalSummary(box.userId(), env, true);

    AnalyzePersonalRequest req = captured();
    assertThat(req.includeNeedsReply()).isFalse();
    assertThat(req.sender().relation()).isEqualTo("UNKNOWN");
  }
}
