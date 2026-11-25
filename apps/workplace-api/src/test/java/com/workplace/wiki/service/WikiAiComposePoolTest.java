package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.WikiAiAction;
import com.workplace.wiki.dto.WikiAiRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageKind;
import com.workplace.wiki.outbound.WikiAiAgentStreamClient;
import com.workplace.wiki.repository.WikiPageRepository;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 노트 AI 작성 시작이 커넥션을 겹쳐 빌리지 않는지(WP-1974 리뷰 후속) — 실제 스프링 빈과 실제 DB 슬롯 저장소로, 커넥션 풀 크기만큼의 요청이 동시에 읽기
 * 트랜잭션 안에 있어도 모두 생성 슬롯을 잡고 끝나는지 본다.
 *
 * <p>예전에는 읽기 트랜잭션(커넥션 하나)을 쥔 채 슬롯 저장소가 REQUIRES_NEW 로 커넥션을 하나 더 빌렸다. 풀 크기만큼의 요청이 모두 첫 커넥션을 쥐면 아무도 두
 * 번째를 얻지 못해 Hikari 대기 제한(30초)까지 막히고 실패했다. 테스트 풀은 2 라 요청 둘이면 그 상황이 된다.
 */
class WikiAiComposePoolTest extends IntegrationTestBase {

  private static final long PAGE_ID = 9_101L;
  private static final long SPACE_ID = 9_102L;

  @Autowired WikiAiService service;

  @MockitoBean WikiPageRepository pages;
  @MockitoBean WikiPermissions perms;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoBean WikiAiAgentStreamClient agent;

  @Value("${spring.datasource.hikari.maximum-pool-size}")
  int poolSize;

  private ExecutorService callers;

  @AfterEach
  void tearDown() {
    if (callers != null) callers.shutdownNow();
  }

  private static WikiPageDetail page() {
    return new WikiPageDetail(
        PAGE_ID,
        SPACE_ID,
        null,
        "동시 작성",
        "본문",
        1,
        1L,
        OffsetDateTime.now(),
        null,
        null,
        false,
        false,
        false,
        WikiPageKind.NOTE,
        null,
        null);
  }

  @Test
  void 풀_크기만큼_동시에_읽기_트랜잭션을_쥐어도_모든_작성이_슬롯을_잡는다() throws Exception {
    long tenantId = defaultTenantId();
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(900L, "claude-opus", "NORMAL", 5));
    // 요청마다 읽기 트랜잭션(커넥션 하나)을 쥔 채 여기서 모두 만난다 — 풀의 커넥션이 전부 요청 첫 커넥션으로 잡힌 순간을 만든다.
    CyclicBarrier allHoldingConnection = new CyclicBarrier(poolSize);
    List<Boolean> inTransaction = new ArrayList<>();
    doAnswer(
            inv -> {
              synchronized (inTransaction) {
                inTransaction.add(TransactionSynchronizationManager.isActualTransactionActive());
              }
              allHoldingConnection.await(20, TimeUnit.SECONDS);
              return null;
            })
        .when(perms)
        .requireRole(eq(SPACE_ID), anyLong(), eq("EDITOR"));

    callers = Executors.newFixedThreadPool(poolSize);
    List<Future<String>> results = new ArrayList<>();
    for (int i = 0; i < poolSize; i++) {
      // 소유자를 나눠 같은 대화 BUSY 와 무관하게 한다(태그 없는 슬롯이라 상한도 없다).
      long caller = 3_000_000_000L + i;
      results.add(
          callers.submit(
              () ->
                  TenantContext.callAs(
                      tenantId,
                      () ->
                          service.startCompose(
                              caller,
                              PAGE_ID,
                              new WikiAiRequest(WikiAiAction.CONTINUE, "이어 써 줘", null)))));
    }

    // Hikari 대기 제한(30초)보다 짧게 기다린다 — 겹쳐 빌리면 여기서 시간이 넘거나 커넥션을 얻지 못한 예외가 난다. 장벽은 20초까지 기다려,
    // 같은 컨텍스트의 배경 작업이 잠깐 커넥션을 빌려도 요청 둘이 모두 들어올 여유를 둔다.
    for (Future<String> result : results) {
      assertThat(result.get(25, TimeUnit.SECONDS)).isNotBlank();
    }
    // 권한 확인은 여전히 읽기 트랜잭션 안에서 한다(RLS GUC — #654).
    assertThat(inTransaction).hasSize(poolSize).containsOnly(true);
  }
}
