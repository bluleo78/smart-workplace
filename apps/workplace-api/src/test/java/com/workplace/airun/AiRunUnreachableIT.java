package com.workplace.airun;

import static com.workplace.jooq.Tables.AI_RUN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.airun.outbound.AiAgentHttp;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.net.ServerSocket;
import java.time.Duration;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/**
 * WP-1829: 실제 공장({@link AiAgentHttp})으로 만든 클라이언트가 닿지 못하는 포트를 부르면 실제 ai_run 행이
 * FAILED·agent_unreachable 로 남는지 끝까지 확인한다(테넌트 결정·RLS·REQUIRES_NEW 포함). 레코더를 목으로 쓰는 인터셉터 단위 테스트가 못
 * 보는 부분이다.
 */
class AiRunUnreachableIT extends IntegrationTestBase {

  @Autowired AiAgentHttp aiAgentHttp;
  @Autowired DSLContext dsl;

  @Test
  void connectionRefused_recordsFailedRowWithAgentUnreachable() throws Exception {
    int closedPort;
    try (ServerSocket s = new ServerSocket(0)) {
      closedPort = s.getLocalPort(); // 열었다 바로 닫아 연결이 거부되는 포트를 얻는다
    }
    RestClient client =
        aiAgentHttp
            .restClient(
                "http://127.0.0.1:" + closedPort, Duration.ofSeconds(2), Duration.ofSeconds(2))
            .build();

    TenantContext.set(1L);
    try {
      assertThatThrownBy(
              () ->
                  client
                      .post()
                      .uri("/mail/classify-batch")
                      .header("Content-Type", "application/json")
                      .body("{}")
                      .retrieve()
                      .toBodilessEntity())
          .isInstanceOf(ResourceAccessException.class);

      var row =
          new TransactionTemplate(txManager)
              .execute(
                  s ->
                      dsl.select(AI_RUN.STATUS, AI_RUN.ERROR_REASON, AI_RUN.KIND)
                          .from(AI_RUN)
                          .where(AI_RUN.KIND.eq("MAIL_CLASSIFY_BATCH"))
                          .and(AI_RUN.ERROR_REASON.eq("agent_unreachable"))
                          .orderBy(AI_RUN.STARTED_AT.desc())
                          .limit(1)
                          .fetchOne());
      assertThat(row).isNotNull();
      assertThat(row.get(AI_RUN.STATUS)).isEqualTo("FAILED");
      assertThat(row.get(AI_RUN.ERROR_REASON)).isEqualTo("agent_unreachable");
    } finally {
      TenantContext.clear();
    }
  }
}
