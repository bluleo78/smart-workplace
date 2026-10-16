package com.workplace.filepreview.service;

import com.workplace.filepreview.outbound.ConverterClient;
import com.workplace.filepreview.outbound.ConverterProperties;
import com.workplace.global.tenant.TenantContextTaskDecorator;
import java.util.concurrent.Executor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.transaction.PlatformTransactionManager;

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

  /**
   * 드라이브·메일 미리보기가 함께 쓰는 변환 상태기계(WP-432) — 같은 대화형 실행기·트랜잭션 관리자로 하나만 둔다. 클래스 자체는 어노테이션 없이 둬 테스트가 다른
   * 설정으로 직접 만들 수 있게 한다.
   */
  @Bean
  public PreviewEngine previewEngine(
      ConverterClient converter,
      ConverterProperties props,
      PlatformTransactionManager txManager,
      @Qualifier("filePreviewInteractiveExecutor") Executor interactiveExecutor) {
    return new PreviewEngine(converter, props, txManager, interactiveExecutor);
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
