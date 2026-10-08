package com.workplace.global.outbound;

import com.workplace.global.tenant.TenantContextTaskDecorator;
import java.util.concurrent.Executor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** ai-agent 발사 관련 Bean 등록. @EnableAsync 로 dispatcher 핸들러를 별도 executor 에서 실행. */
@Configuration
@EnableAsync
public class OutboundConfig {

  /**
   * ai-agent 전용 RestClient 를 구성한 client bean. production 백오프 1초. 테스트는 생성자 직접 호출로 override. 요청 팩토리는
   * HTTP/1.1 고정({@link InternalHttp}, WP-305). 타임아웃은 이전(팩토리 미지정 = JDK 기본, 무제한)과 같게 둔다.
   */
  @Bean
  public AiAgentEventClient aiAgentEventClient(AiAgentProperties props) {
    var builder = InternalHttp.restClient(props.baseUrl());
    return new AiAgentEventClient(builder, props.internalToken(), 1000L);
  }

  /**
   * ai-agent 발사 전용 executor. dispatcher 의 @TransactionalEventListener 핸들러를 호출 스레드와 분리해 ai-agent 다운
   * 시의 HTTP 재시도 백오프(최대 7s)가 도메인 API 응답을 막지 않도록 보장한다. core/max 2/4, queue 100 — 발사 부하는 매우 낮으므로 충분.
   */
  @Bean(name = "aiAgentEventExecutor")
  public Executor aiAgentEventExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("ai-agent-");
    // TenantContext 전파 — 향후 핸들러가 RLS 테이블을 읽을 때도 GUC 가 올바르게 주입되도록.
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * 위키 인에디터 /ai 스트리밍 전용 executor (S3 B2). 각 작업이 ai-agent SSE 펌프로 스레드를 10–60s 점유하므로 가벼운 발사용 {@code
   * aiAgentEventExecutor} 와 절대 공유하지 않는다(공유 시 이벤트 디스패치 고갈). core/max 4/8, queue 는 작게(동시 스트림 수 제한) —
   * 초과 요청은 호출 스레드에서 reject 되어 빠르게 503/오류로 떨어지게 둔다.
   */
  @Bean(name = "wikiAiStreamExecutor")
  public org.springframework.core.task.AsyncTaskExecutor wikiAiStreamExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(4);
    executor.setMaxPoolSize(8);
    executor.setQueueCapacity(16);
    executor.setThreadNamePrefix("wiki-ai-");
    // TenantContext 전파 — 펌프 스레드가 emitter 로 흘리는 동안 GUC 컨텍스트 일관 유지.
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * AI 컴포즈 SSE 스트리밍 전용 executor (B2). 각 작업이 ai-agent SSE 펌프로 스레드를 10–300s 점유하므로 이벤트 발사용 {@code
   * aiAgentEventExecutor} 와 절대 공유하지 않는다. core/max 4/8, queue 는 작게(동시 스트림 수 제한) — 초과 요청은 호출 스레드에서
   * reject 되어 빠르게 오류로 떨어지게 둔다.
   */
  @Bean(name = "aiChatStreamExecutor")
  public org.springframework.core.task.AsyncTaskExecutor aiChatStreamExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(4);
    executor.setMaxPoolSize(8);
    executor.setQueueCapacity(16);
    executor.setThreadNamePrefix("ai-compose-");
    // TenantContext 전파 — 펌프 스레드에서 ASSISTANT appendMessage 시 GUC 컨텍스트 일관 유지.
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * 메일 읽음 동기화(MailReadSyncListener) 전용 실행기.
   *
   * <p>IMAP STORE / Graph PATCH 작업은 스레드를 수 초간 점유하므로 경량 aiAgentEventExecutor 와 분리해야 한다(공유 시 이벤트 디스패치
   * 고갈). bare {@code @Async} 는 Executor 빈이 여러 개면 SimpleAsyncTaskExecutor(스레드 무제한 생성)로 조용히 폴백하므로 반드시
   * 전용 빈을 명시 한정한다.
   */
  @Bean(name = "mailReadSyncExecutor")
  public Executor mailReadSyncExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("mail-readsync-");
    // TenantContext 전파 — MailReadSyncListener 가 명시 주입하지만 데코레이터를 이중 방어선으로.
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * 새 기준 메일 재분석(WP-151 MailReanalysisScheduler) 전용 단일 스레드 실행기.
   *
   * <p>재분석은 계정마다 LLM 을 최대 50회 순서대로 부르므로 수 분간 스레드를 점유한다. 몇 개 안 되는 스프링 스케줄러 공용 스레드(다른 @Scheduled 작업이
   * 밀림)나 이벤트 발사용 aiAgentEventExecutor(고갈 시 채팅·메시징 디스패치 지연)에서 돌리지 않도록 분리한다. core/max 1 이라 LLM 동시 호출이
   * 없다(비용 ·부하 페이싱). 겹침은 스케줄러의 running 플래그가 막으므로 queue 1 이면 충분하다. TenantContext 는 스케줄러가 계정별로 직접
   * 설정하므로 데코레이터를 두지 않는다.
   */
  @Bean(name = "mailReanalysisExecutor")
  public Executor mailReanalysisExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(1);
    executor.setMaxPoolSize(1);
    executor.setQueueCapacity(1);
    executor.setThreadNamePrefix("mail-reanalysis-");
    executor.initialize();
    return executor;
  }

  /**
   * 받은편지함 전체 메일 카테고리 일괄 분류(WP-185 MailCategoryBackfillScheduler) 전용 단일 스레드 실행기.
   *
   * <p>한 회차가 25통 묶음 LLM 호출을 최대 20회(회차 상한) 순서대로 부르므로 수 분간 스레드를 점유한다. 몇 개 안 되는 스프링 스케줄러 공용 스레드(자동
   * 동기화·선제 요약 등이 밀림)나 채팅 AI 디스패치와 공유하는 aiAgentEventExecutor(고갈·거절)에서 돌리지 않도록 분리한다 —
   * mailReanalysisExecutor 와 같은 이유·크기. core/max 1 이라 LLM 동시 호출이 없고, 겹침은 스케줄러의 running 플래그가 막으므로
   * queue 1 이면 충분하다. TenantContext 는 스케줄러가 계정별로 직접 설정하므로 데코레이터를 두지 않는다.
   */
  @Bean(name = "mailCategoryBackfillExecutor")
  public Executor mailCategoryBackfillExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(1);
    executor.setMaxPoolSize(1);
    executor.setQueueCapacity(1);
    executor.setThreadNamePrefix("mail-category-");
    executor.initialize();
    return executor;
  }

  /**
   * 이슈 Instant Context 요약 생성 전용 executor (#517). 요약 HTTP(read 90s)는 스레드를 장시간 점유하므로 경량
   * aiAgentEventExecutor(이벤트 발사)와 공유 금지(공유 시 이벤트 디스패치 고갈). 데코레이터로 TenantContext 전파 → @Async
   * AFTER_COMMIT 핸들러가 워커 스레드에서 트랜잭션 시작 시 GUC 주입(issue_ai_summary RLS fail-closed 회피).
   */
  @Bean(name = "issueAiSummaryExecutor")
  public Executor issueAiSummaryExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("issue-ai-summary-");
    // TenantContext 전파 — @Async AFTER_COMMIT 핸들러가 워커 스레드에서 트랜잭션 시작 시
    // TenantAwareTransactionManager 가 GUC(app.tenant_id) 를 주입할 수 있도록.
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * 메인 AI 채팅 누적 요약 전용 executor(WP-232). 요약 HTTP(read 90s)가 스레드를 오래 점유하므로 채팅 스트림
   * 펌프(aiChatStreamExecutor)와 분리한다. 세션당 1건만 예약되고(in-flight 가드) 지연돼도 원문이 유지되므로 소형 풀. 큐 초과는 reject →
   * 다음 턴에 재예약. TenantContext 를 전파해 워커의 트랜잭션이 RLS GUC 를 받게 한다.
   */
  @Bean(name = "homeContextSummaryExecutor")
  public org.springframework.core.task.AsyncTaskExecutor homeContextSummaryExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(1);
    executor.setMaxPoolSize(2);
    executor.setQueueCapacity(50);
    executor.setThreadNamePrefix("home-ctx-summary-");
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * Drive Overview SSE 펌프 전용 executor. ai-agent SSE 로 스레드를 10–300s 점유하므로 wiki/chat 스트림과 분리해 경합을
   * 회피한다. core/max 4/8, queue 는 작게(동시 스트림 수 제한) — 초과 요청은 호출 스레드에서 reject 되어 빠르게 오류로 떨어지게 둔다.
   */
  @Bean(name = "driveOverviewStreamExecutor")
  public org.springframework.core.task.AsyncTaskExecutor driveOverviewStreamExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(4);
    executor.setMaxPoolSize(8);
    executor.setQueueCapacity(16);
    executor.setThreadNamePrefix("drive-ov-");
    // TenantContext 전파 — 펌프 스레드가 emitter 로 흘리는 동안 GUC 컨텍스트 일관 유지.
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * notify 디스패처 전용 executor. @Async 무인자는 단일 Executor 빈(aiAgentEventExecutor)에 바인딩되거나, 빈이 2개면 모호해져
   * SimpleAsyncTaskExecutor 로 조용히 폴백한다. 따라서 항상 명시 한정(@Async("notifyEventExecutor"))한다. 알림은 가벼운
   * insert+fan-out 이므로 작은 풀로 충분, queue 는 버스트 흡수용으로 넉넉히.
   */
  @Bean(name = "notifyEventExecutor")
  public Executor notifyEventExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(500);
    executor.setThreadNamePrefix("notify-");
    // TenantContext 전파 — @Async AFTER_COMMIT 핸들러가 워커 스레드에서 트랜잭션을 시작할 때
    // TenantAwareTransactionManager 가 GUC(app.tenant_id) 를 주입할 수 있도록.
    // (issue_watcher 등 RLS 보호 테이블 조회가 fail-closed 로 차단되지 않도록 하는 핵심 조치)
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }
}
