package com.workplace.home;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.USER;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.AiAgentContextSummaryClient;
import com.workplace.home.service.HomeAttachmentService;
import com.workplace.home.service.HomeChatService;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메인 AI 채팅 첨부(WP-234) 통합 테스트 공용 기반.
 *
 * <p>애노테이션·목 구성은 HomeChatContextBudgetTest 와 같게 둔다 — Spring 컨텍스트 캐시를 공유해 컨텍스트가 하나 더 뜨지 않게. 서비스가 자체
 * 트랜잭션을 커밋하고 채팅 펌프가 다른 스레드에서 돌기 때문에 @Transactional 을 쓰지 않고 @AfterEach 에서 tenant 트랜잭션으로 정리한다.
 */
@TestPropertySource(
    properties = {
      "workplace.ai-agent.enabled=true",
      "workplace.home.chat.context-token-budget=400"
    })
public abstract class HomeAttachmentTestSupport extends IntegrationTestBase {

  @MockitoBean protected AiAgentChatClient chatClient;
  @MockitoBean protected AiAgentContextSummaryClient summaryClient;
  @MockitoBean protected AssistantResolver assistantResolver;
  @MockitoBean protected SseRegistry sseRegistry;
  @MockitoBean protected TenantScopedRunner tenantScopedRunner;

  @Autowired protected DSLContext dsl;
  @Autowired protected ObjectMapper om;
  @Autowired protected MockMvc mockMvc;
  @Autowired protected JwtTokenProvider jwtTokenProvider;
  @Autowired protected HomeSessionService sessionService;
  @Autowired protected HomeAttachmentService attachmentService;
  @Autowired protected HomeChatService chatService;

  /** 이 테스트가 만든 사용자 — 정리 대상. */
  protected final List<Long> users = new ArrayList<>();

  /** FilePathBuilder·RLS 트랜잭션이 테넌트 컨텍스트를 요구한다. */
  @BeforeEach
  void setTenantForAttachments() {
    TenantContext.set(1L);
  }

  /** file(uploaded_by) → home_session → user 순으로 정리. 정션·file_extraction 은 file CASCADE. */
  @AfterEach
  void cleanupAttachments() {
    TenantContext.clear();
    if (users.isEmpty()) return;
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(FILE).where(FILE.UPLOADED_BY.in(users)).execute();
          dsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.USER_ID.in(users)).execute();
        });
    dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    users.clear();
  }

  /** HUMAN 사용자 + tenant#1 멤버십(대행 인증 테넌트 해석용) + 비서 스펙 스텁. */
  protected long user() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    users.add(id);
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
    return id;
  }

  /** tenant 클레임이 든 브라우저 JWT. */
  protected String bearer(long uid) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(uid, "u" + uid, 1L);
  }

  /** MockMvc 요청 — JwtAuthenticationFilter 가 finally 에서 지운 테스트 스레드의 TenantContext 를 되돌린다. */
  protected ResultActions http(RequestBuilder rb) throws Exception {
    try {
      return mockMvc.perform(rb);
    } finally {
      TenantContext.set(1L);
    }
  }

  /** 서비스로 1개 업로드하고 fileId 반환. */
  protected long upload(long uid, String name, String mime, byte[] bytes) {
    return attachmentService
        .upload(uid, List.of(new MockMultipartFile("files", name, mime, bytes)))
        .get(0)
        .fileId();
  }

  /** tenant#1 트랜잭션 안에서 조회(RLS GUC 주입). */
  protected <T> T inTx(Supplier<T> s) {
    TenantContext.set(1L);
    return new TransactionTemplate(txManager).execute(st -> s.get());
  }
}
