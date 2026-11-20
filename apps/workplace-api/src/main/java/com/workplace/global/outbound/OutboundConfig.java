package com.workplace.global.outbound;

import com.workplace.global.tenant.TenantContextTaskDecorator;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
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
   *
   * <p>짧은 발사 전용 — 오래 붙잡는 일(메일 분석·계정 동기화 등)은 두지 않는다(WP-1812: 메일 분석이 60초씩 붙잡아 이슈·채팅 이벤트가 거절됐다).
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
   * 메일 서명 저장(WP-1517)의 이미지 받기를 나란히 돌리는 실행기. 붙여 넣은 서명의 외부 이미지(최대 10개, 건당 가져오기 타임아웃)를 순서대로 받으면 저장 요청이
   * 이미지 수만큼 길어지므로 나눠 받는다. DB 를 쓰지 않는 순수 HTTP·디코드라 테넌트 전파가 필요 없다. 풀이 작아(4) 한 사람의 저장이 서버 스레드를 많이 차지하지
   * 않고, 큐가 차면 요청 스레드가 직접 받는다(CallerRuns) — 버리지 않고 순차로 물러날 뿐이라 이미지가 빠지지 않는다.
   */
  @Bean(name = "mailSignatureFetchExecutor")
  public Executor mailSignatureFetchExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(4);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(40);
    executor.setThreadNamePrefix("mail-signature-fetch-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
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
   * 메일 휴지통 비우기(WP-1682 MailTrashEmptyJob) 전용 executor. 한 작업이 메일 서버 휴지통 전체를 묶음씩 지우느라(Outlook 은 수천
   * 통이면 수 분) 스레드를 오래 점유하므로 다른 풀과 나눈다. 계정당 작업은 하나(진행 상태가 막는다)라 core/max 2·queue 10 이면 충분하고, 넘치면 기본
   * AbortPolicy 가 TaskRejectedException 을 던져 호출부가 진행 상태를 풀고 503(TRASH_EMPTY_BUSY)으로 돌려준다.
   *
   * <p>종료 때 기다리지 않는다(wait=false) — 그래야 shutdownNow() 가 실행 중 작업에 인터럽트를 보내고, 작업은 묶음 사이에서 그것을 보고
   * FAILED(INTERRUPTED)를 남긴 뒤 멈춘다(이미 지운 묶음은 로컬도 반영돼 있다). wait=true 면 인터럽트가 가지 않아 긴 비우기가 종료를 막는다.
   * awaitTermination 20초 안에 지금 묶음을 마치고 끝난다. TenantContext 를 전파해 묶음마다의 로컬 반영 트랜잭션이 RLS GUC 를 받게 한다.
   * 테스트가 TaskExecutor 주입 지점에 넣으므로 구체 타입으로 노출한다(homeSuggestionExecutor 와 같다).
   */
  @Bean(name = "mailTrashEmptyExecutor")
  public ThreadPoolTaskExecutor mailTrashEmptyExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(2);
    executor.setQueueCapacity(10);
    executor.setThreadNamePrefix("mail-trash-empty-");
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.setWaitForTasksToCompleteOnShutdown(false);
    executor.setAwaitTerminationSeconds(20);
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
   * 후속 질문 전용 executor(WP-139). ai-agent 호출(최대 read 25s)이 채팅 펌프 스레드를 붙잡지 않게 분리한다. 후속 질문은 없어도 되는 부가
   * 기능이라 소형 풀 + 짧은 큐(core 2·max 2·queue 32)이고 넘치면 버린다(호출부가 TaskRejectedException 을 삼킨다).
   *
   * <p>core 와 max 를 같게 두는 이유: ThreadPoolExecutor 는 큐가 가득 찬 뒤에야 core 를 넘는 스레드를 만든다. core 1·max 2 였을
   * 땐 큐(32)가 차기 전까지 스레드 1개만 돌아 모든 사용자의 후속 질문(건당 수 초~20초)이 한 줄로 직렬화됐다. 2개면 한 사람의 느린 생성이 다른 사람을 막지
   * 않으면서, ai-agent 의 동시 실행(Claude 프로세스)을 부가 기능이 과하게 점유하지 않는다.
   *
   * <p>TenantContext 를 전파해 저장 트랜잭션이 RLS GUC 를 받게 한다. 테스트(HomeFollowupTest)가 스파이로 제출을 세고 풀의 누적 완료 작업
   * 수(getThreadPoolExecutor)로 끝남을 기다리므로 구체 타입으로 노출한다.
   */
  @Bean(name = "homeSuggestionExecutor")
  public ThreadPoolTaskExecutor homeSuggestionExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(2);
    executor.setQueueCapacity(32);
    executor.setThreadNamePrefix("home-suggest-");
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * 이슈 챗 AI 질문 글의 답 선택지 보완 추출 전용 executor(WP-1569 QuestionOptionsService). 홈 후속 질문
   * (homeSuggestionExecutor)과 풀을 나눠, AI 질문이 몰려도 사람이 보는 홈 후속 질문이 밀리지 않게 한다. 없어도 되는 부가 기능이라 소형
   * 풀(core·max 1)과 짧은 큐(16)로 ai-agent 동시 호출을 묶고, 넘치면 버린다 — 기본 AbortPolicy 가 TaskRejectedException 을
   * 던지면 호출부가 삼킨다(질문 글은 선택지 없이 남는다). TenantContext 를 전파해 워커의 트랜잭션이 RLS GUC 를 받게 한다. 테스트가 풀의 누적 완료 작업
   * 수로 끝남을 기다리므로 구체 타입으로 노출한다.
   */
  @Bean(name = "questionOptionsExecutor")
  public ThreadPoolTaskExecutor questionOptionsExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(1);
    executor.setMaxPoolSize(1);
    executor.setQueueCapacity(16);
    executor.setThreadNamePrefix("question-options-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
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
   * 업무 프로파일 분석(WP-1485 WorkProfileService) 전용 executor. 한 건이 ai-agent 분류 호출로 스레드를 수십 초 점유하므로 이벤트
   * 발사용 {@code aiAgentEventExecutor} 와 분리한다. core/max 2 로 LLM 동시 호출을 묶고(core 와 max 를 같게 둬야 큐가 차기
   * 전에도 2개가 돈다 — homeSuggestionExecutor 참조). 매일 갱신은 스케줄러 스레드에서 동기로 돌아 이 풀을 쓰지 않으므로, 큐는 사람이 띄운 분석(카드
   * 조회의 자동 시작·「다시 분석」 — 하루 상한으로 묶임)만 받으면 돼 100 으로 둔다. 넘치면 호출부가 TaskRejectedException 을 받아 행을 FAILED
   * 로 둔다. TenantContext 를 전파해 워커의 트랜잭션이 RLS GUC 를 받게 한다.
   */
  @Bean(name = "workProfileExecutor")
  public ThreadPoolTaskExecutor workProfileExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(2);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("work-profile-");
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * 개인 보고 「보고서 만들기」(WP-1486 PersonalReportService) 전용 executor. 한 편이 ai-agent 보고 작성(1~3분)으로 스레드를 오래
   * 점유하므로 다른 풀과 나눈다. core 1 / max 2 / queue 20 — 수동 생성은 사람마다 하루 20번으로 묶여 있고, 매일 아침 자동 일일은 실행기 스레드에서
   * 동기로 돌아 이 풀을 쓰지 않는다. 넘치면 호출부가 TaskRejectedException 을 받아 회차를 FAILED 로 닫는다. TenantContext 를 전파해
   * 워커의 트랜잭션이 RLS GUC 를 받게 한다.
   */
  @Bean(name = "personalReportExecutor")
  public ThreadPoolTaskExecutor personalReportExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(1);
    executor.setMaxPoolSize(2);
    executor.setQueueCapacity(20);
    executor.setThreadNamePrefix("personal-report-");
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

  /**
   * 메일 선제 분석(분류·요약 백필)·AI 켬 백필 전용 executor(WP-1812). 한 건이 LLM 호출로 스레드를 수십 초 점유하므로 이벤트 발사용 {@code
   * aiAgentEventExecutor} 와 분리한다. core/max 2·queue 50 — 넘치면 AbortPolicy 가 TaskRejectedException 을
   * 던지고 호출부가 로그만 남긴다(다음 주기가 다시 집는다). 본문 보충은 여기서 돌지 않는다 — {@link #mailBodyBackfillExecutor}.
   * TenantContext 를 전파해 워커의 트랜잭션이 RLS GUC 를 받게 한다.
   */
  @Bean(name = "mailAnalysisExecutor")
  public ThreadPoolTaskExecutor mailAnalysisExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(2);
    executor.setQueueCapacity(50);
    executor.setThreadNamePrefix("mail-analysis-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * 메일 본문 보충(동기화마다 한 번 — {@code MailBackfillService.backfill}) 전용 executor(WP-1812 리뷰 후속). 본문·첨부
   * 가져오기(IMAP/Graph I/O)와 새 메일 푸시를 LLM 분석 풀({@link #mailAnalysisExecutor}, 2스레드·큐 50)에 함께 두면 계정이
   * 많거나 모델이 느릴 때 같은 순서의 계정이 매 회차 거절돼 본문이 늦게 오르거나 안 올랐다. 그래서 분석과 떼고, 보충 끝의 적재 후 분석도 분석 풀로 넘겨 이 스레드는
   * I/O 만 한다. core=max 4·queue 100 — ThreadPoolExecutor 는 큐가 찬 뒤에야 core 를 넘겨 스레드를 늘리므로 core 를 max 와
   * 같게 둬 4개가 바로 돈다. 동기화 스케줄러는 계정마다 한 번만 넣고(진행 중이면 tryStart 가 막는다) 3분 주기라 활성 계정이 100 을 넘지 않는 한 큐가 차지
   * 않는다. 넘치면 AbortPolicy → 호출부 (MailSyncService)가 TaskRejectedException 을 받아 진행 상태를 풀고 로그만 남긴다(다음
   * 주기가 다시 집는다). TenantContext 를 전파한다.
   */
  @Bean(name = "mailBodyBackfillExecutor")
  public ThreadPoolTaskExecutor mailBodyBackfillExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(4);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("mail-body-backfill-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * 거절된 반복 회차의 실패 기록 전용 executor(WP-1812 리뷰 후속). 회차 리스너(AFTER_COMMIT, 커밋 콜백 안)가 실패 기록(REQUIRES_NEW
   * — 새 커넥션)을 직접 부르면 커밋 콜백 안에서 두 번째 커넥션을 빌리게 되므로(global/util/AfterCommit 이 금지한 꼴) 이 스레드로 넘긴다. 거절은
   * 드물고 기록은 짧아 core·max 1·queue 100 이면 충분하다. 넘치면 AbortPolicy → 리스너가 로그만 남기고 결과 대기 시간 초과가 정리한다. 배포로
   * 내려갈 때 큐에 남은 기록을 버리지 않게 최대 10초 기다린다(버리면 그 회차가 40분 대기 뒤에야 실패로 드러난다). TenantContext 를 전파한다.
   */
  @Bean(name = "recurrenceDispatchFailExecutor")
  public ThreadPoolTaskExecutor recurrenceDispatchFailExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(1);
    executor.setMaxPoolSize(1);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("recurrence-fail-");
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(10);
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * 메일·캘린더 계정 즉시 동기화와 계정 정리 전용 executor(WP-1812). IMAP/Graph 네트워크 I/O 가 오래 걸려 이벤트 발사 풀과 나누고, 분석 풀과도
   * 나눠 동기화가 분석 뒤에 줄 서지 않게 한다. core 2·max 4·queue 100, 넘치면 AbortPolicy — 쓰는 곳은 모두 AFTER_COMMIT 리스너라
   * 거절은 Spring 이 로그로 삼키고 각 주기 스케줄러가 다음 사이클에 다시 한다(리스너 javadoc). TenantContext 를 전파한다.
   */
  @Bean(name = "mailAccountSyncExecutor")
  public ThreadPoolTaskExecutor mailAccountSyncExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("mail-account-sync-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }
}
