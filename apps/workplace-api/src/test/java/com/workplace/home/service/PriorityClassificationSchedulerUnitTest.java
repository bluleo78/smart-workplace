package com.workplace.home.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.outbound.AiAgentPriorityClient;
import com.workplace.home.repository.PriorityItemRepository;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.mail.dto.MailSummaryResponse;
import com.workplace.mail.service.MailMessageService;
import com.workplace.messaging.dto.MessagingSummaryResponse;
import com.workplace.messaging.service.MessagingSummaryService;
import com.workplace.notify.service.NotificationService;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.LocalDateTime;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * PriorityClassificationScheduler 단위 테스트(Spring 컨텍스트/DB 없이 Mockito 만) — 리뷰에서 지적된 Critical 버그(저장이
 * Spring 트랜잭션 밖에서 실행되면 RLS GUC 미주입)의 회귀를 검증한다.
 *
 * <p>MailSummaryBackfillServiceTest 와 동일 패턴: PlatformTransactionManager 를 모킹해 {@code
 * txManager.getTransaction(...)} 이 repo.replaceForUser 호출 "이전에" 실제로
 * 호출됐는지(=TransactionTemplate.execute 를 거쳤는지)를 InOrder 로 직접 검증한다.
 *
 * <p>왜 통합테스트(IntegrationTestBase) 대신 이 방식인가: 세션 레벨 GUC 를 오염시켜 실제 RLS 위반을 재현하는 시도는 HikariCP 커넥션 풀이
 * 여러 커넥션을 갖고 있어 오염을 준 커넥션과 스케줄러 저장이 실제 사용하는 커넥션이 다를 수 있어 비결정적이었다(실측: 트랜잭션 래핑을 되돌린 상태에서도 우연히 통과).
 * 여기서는 "저장 호출 전 실제 트랜잭션이 열렸는가" 를 Mockito verify(InOrder) 로 결정적으로 검증한다 —
 * TenantAwareTransactionManager 의 GUC 주입 자체는 doBegin() 단위 테스트/기존 통합 테스트가 이미 별도로 보장한다.
 */
@ExtendWith(MockitoExtension.class)
class PriorityClassificationSchedulerUnitTest {

  private static final long TENANT_ID = 1L;
  private static final long USER_ID = 42L;

  @Mock private TenantScopedRunner tenantRunner;
  @Mock private UserRepository userRepo;
  @Mock private IssueSearchService issueSearchService;
  @Mock private NotificationService notificationService;
  @Mock private MailMessageService mailMessageService;
  @Mock private MessagingSummaryService messagingSummaryService;
  @Mock private AiAgentPriorityClient aiClient;
  @Mock private AssistantResolver assistantResolver;
  @Mock private PriorityItemRepository repo;
  @Mock private PlatformTransactionManager txManager;

  private PriorityClassificationScheduler scheduler;

  @BeforeEach
  void setUp() {
    // TransactionTemplate 이 txManager.getTransaction() 을 호출할 때 더미 상태 반환 →
    // execute(callback) 이 콜백을 동기 실행하도록 허용(MailSummaryBackfillServiceTest 미러).
    given(txManager.getTransaction(any(TransactionDefinition.class)))
        .willReturn(new SimpleTransactionStatus());

    scheduler =
        new PriorityClassificationScheduler(
            tenantRunner,
            userRepo,
            issueSearchService,
            notificationService,
            mailMessageService,
            messagingSummaryService,
            aiClient,
            assistantResolver,
            repo,
            txManager);

    // forEachActiveTenant(consumer) 가 테넌트 1개(TENANT_ID)에 대해 콜백을 실행하도록.
    doAnswer(
            invocation -> {
              Consumer<Long> action = invocation.getArgument(0);
              action.accept(TENANT_ID);
              return null;
            })
        .when(tenantRunner)
        .forEachActiveTenant(any());

    given(userRepo.findByKind(TENANT_ID, "HUMAN"))
        .willReturn(
            List.of(
                new UserResponse(
                    USER_ID, "u", "u@example.com", "유저", true, LocalDateTime.now(), "HUMAN")));

    // 4개 후보 소스 모두 빈 결과 — candidates.isEmpty() 분기(빈 리스트 replaceForUser)를 태운다.
    given(issueSearchService.searchMine(eq(USER_ID), any()))
        .willReturn(new IssueSearchResponse(List.of(), null, false));
    given(notificationService.listRecent(eq(USER_ID), anyInt())).willReturn(List.of());
    given(mailMessageService.summary(eq(USER_ID), anyInt()))
        .willReturn(new MailSummaryResponse(0, 0, false, List.of()));
    given(messagingSummaryService.summary(eq(USER_ID), anyInt()))
        .willReturn(new MessagingSummaryResponse(0, 0, 0, 0, List.of()));
  }

  @Test
  void 빈_후보_저장이_실제_트랜잭션_안에서_실행된다() {
    scheduler.runOnce();

    // 핵심 단언: repo.replaceForUser 호출 "이전"에 txManager.getTransaction() 이 실제로 호출됐다 —
    // 즉 저장이 TransactionTemplate.execute(...) 를 통해 진짜 Spring 트랜잭션 경계 안에서 실행됐음을 증명한다.
    // 리뷰가 지적한 버그(트랜잭션 밖 직접 호출)라면 getTransaction() 이 전혀 호출되지 않아 이 순서 단언이 실패한다.
    InOrder order = Mockito.inOrder(txManager, repo);
    order.verify(txManager, times(1)).getTransaction(any(TransactionDefinition.class));
    order.verify(repo).replaceForUser(USER_ID, List.of());

    verify(repo, times(1)).replaceForUser(eq(USER_ID), eq(List.of()));
  }
}
