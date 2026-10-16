package com.workplace.filepreview.service;

import com.workplace.filepreview.outbound.ConverterProperties;
import com.workplace.global.tenant.TenantContextTaskDecorator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 문서 미리보기 변환 실행기(WP-431) — 첫 열람(대화형)과 업로드 후 미리 변환(백그라운드)을 나눈다.
 *
 * <p>나누는 이유: 대량 업로드가 백그라운드 큐를 채워도 사용자가 지금 연 문서는 대화형 실행기에서 바로 변환되게 하기 위해서다. 거절 정책은 기본(Abort) 그대로 둔다
 * — 제출한 쪽이 거절을 알아야 선점을 반납하고(대화형) BUSY 로 응답하거나 경고를 남길 수 있다. 큐 크기는 계획서 Global Constraints 고정값.
 */
@Configuration
public class FilePreviewExecutorConfig {

  /** 대화형 실행기 큐 상한. */
  static final int INTERACTIVE_QUEUE = 50;

  /** 백그라운드 실행기 큐 상한 — 넘치면 버리고 첫 열람이 변환한다. */
  static final int BACKGROUND_QUEUE = 500;

  @Bean(name = "filePreviewInteractiveExecutor")
  public ThreadPoolTaskExecutor filePreviewInteractiveExecutor(ConverterProperties props) {
    return executor(props.preview().interactiveConcurrency(), INTERACTIVE_QUEUE, "preview-i-");
  }

  @Bean(name = "filePreviewBackgroundExecutor")
  public ThreadPoolTaskExecutor filePreviewBackgroundExecutor(ConverterProperties props) {
    return executor(props.preview().backgroundConcurrency(), BACKGROUND_QUEUE, "preview-b-");
  }

  /** 고정 크기 풀 + 테넌트 전파 데코레이터. 작업 본문도 tenantId 로 TenantContext 를 다시 세운다(이중 안전). */
  private static ThreadPoolTaskExecutor executor(int size, int queue, String prefix) {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(size);
    ex.setMaxPoolSize(size);
    ex.setQueueCapacity(queue);
    ex.setThreadNamePrefix(prefix);
    ex.setTaskDecorator(new TenantContextTaskDecorator());
    // initialize() 는 빈 수명주기(afterPropertiesSet)가 부른다 — 직접 부르면 풀이 두 번 만들어진다.
    return ex;
  }
}
