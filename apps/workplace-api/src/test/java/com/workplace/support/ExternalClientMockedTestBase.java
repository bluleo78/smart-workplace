package com.workplace.support;

import com.workplace.auth.outbound.AiAgentModelsClient;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.fileai.outbound.WorkerRenderClient;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.home.outbound.AiAgentPriorityClient;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.mail.outbound.AiAgentMailClient;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.messaging.outbound.AiAgentMessagingClient;
import com.workplace.notify.push.PushGateway;
import com.workplace.wiki.outbound.WikiAiAgentSummaryClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 바깥 시스템 클라이언트(ai-agent·Graph·워커·푸시·SSE 등)를 한꺼번에 목으로 바꾼 통합 테스트 기반(WP-1028).
 *
 * <p>클래스마다 목 조합이 조금씩 달라 Spring 컨텍스트를 따로 띄우던(20종) 테스트를 한 컨텍스트로 묶는다. 목은 테스트마다 초기화되므로 공유해도 서로 새지 않는다.
 * 쓰는 목은 {@code @Autowired} 로 받는다. 이 중 하나를 실제 빈으로 시험하는
 * 테스트(GraphTokenServiceTest·GraphBodyLoaderTest·PriorityClassificationSchedulerTest)는 이 기반을 쓰지 않는다.
 */
@MockitoBean(
    types = {
      AiAgentDriveClient.class,
      AiAgentEventClient.class,
      AiAgentIssueClient.class,
      AiAgentMailClient.class,
      AiAgentMessagingClient.class,
      AiAgentModelsClient.class,
      AiAgentPriorityClient.class,
      AssistantResolver.class,
      GraphApiClient.class,
      GraphCalendarClient.class,
      GraphTokenService.class,
      PushGateway.class,
      SseRegistry.class,
      WikiAiAgentSummaryClient.class,
      WorkerClient.class,
      WorkerRenderClient.class
    })
public abstract class ExternalClientMockedTestBase extends IntegrationTestBase {}
