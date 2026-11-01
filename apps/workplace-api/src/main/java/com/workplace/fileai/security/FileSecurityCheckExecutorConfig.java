package com.workplace.fileai.security;

import com.workplace.global.tenant.TenantContextTaskDecorator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * HTML 보안 점검 전용 실행기(WP-1262). 점검은 요약과 같은 LLM 장시간 호출이라 추출 nudge 실행기(경량·HTTP 디스패치)와 나눈다 — 섞으면 점검이
 * nudge 스레드를 오래 쥐어 추출 디스패치가 밀린다. 설정은 {@code issueAiSummaryExecutor} 를 따른다(코어 2·최대 4·큐 100,
 * TenantContext 전파).
 *
 * <p>큐가 넘치면 버린다 — 행이 PENDING 으로 남는다. 저장소 파일(업로드·다시 점검)은 FileSecurityCheckScheduler 가 다시 줍지만, 메일
 * 사본(내부 카테고리)은 스케줄러가 줍지 않아 사용자가 다시 요청해야 돈다(PENDING 이라 요청이 점검을 깨운다). 기본 AbortPolicy 는 커밋 뒤
 * 콜백(afterCommit) 안에서 예외를 던져 요청 응답을 망칠 수 있어 쓰지 않는다. 스케줄러는 제출 전에 큐 여유를 보고 차 있으면 그 회차 제출을 멈춘다.
 */
@Slf4j
@Configuration
public class FileSecurityCheckExecutorConfig {

  /** {@code @Async}·{@code @Qualifier} 로 지정할 빈 이름. */
  public static final String EXECUTOR = "fileSecurityCheckExecutor";

  @Bean(name = EXECUTOR)
  public ThreadPoolTaskExecutor fileSecurityCheckExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(2);
    ex.setMaxPoolSize(4);
    ex.setQueueCapacity(100);
    ex.setThreadNamePrefix("file-security-check-");
    // TenantContext 전파 — 워커 스레드의 트랜잭션이 RLS GUC(app.tenant_id) 를 받게 한다.
    ex.setTaskDecorator(new TenantContextTaskDecorator());
    ex.setRejectedExecutionHandler(
        (r, pool) -> log.warn("[fileai] 보안 점검 큐 초과 — 1건 버림(행은 PENDING 으로 남는다)"));
    // initialize() 는 빈 수명주기(afterPropertiesSet)가 부른다.
    return ex;
  }
}
