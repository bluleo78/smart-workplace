package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.task.TaskSchedulingAutoConfiguration;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.scheduling.annotation.ScheduledAnnotationBeanPostProcessor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * {@link SchedulingConfig} 의 켜짐/꺼짐 조건 검증.
 *
 * <p>운영 기본값(속성 없음)에서 {@code @Scheduled} 처리기가 등록돼야 메일 자동 동기화·리마인더 등이 돈다. 테스트 프로파일만 {@code
 * workplace.scheduling.enabled=false} 로 끈다(WP-80). DB 가 필요 없는 설정 단위 테스트라 IntegrationTestBase 를 쓰지
 * 않는다.
 */
class SchedulingConfigTest {

  private final ApplicationContextRunner runner =
      new ApplicationContextRunner().withUserConfiguration(SchedulingConfig.class);

  @Test
  void 속성이_없으면_스케줄링이_켜진다() {
    runner.run(ctx -> assertThat(ctx).hasSingleBean(ScheduledAnnotationBeanPostProcessor.class));
  }

  @Test
  void enabled_false_면_스케줄링이_꺼진다() {
    runner
        .withPropertyValues("workplace.scheduling.enabled=false")
        .run(ctx -> assertThat(ctx).doesNotHaveBean(ScheduledAnnotationBeanPostProcessor.class));
  }

  /**
   * WP-211 운영 설정(application.yml)이 스케줄러 스레드를 여러 개로 띄운다 — 긴 LLM 작업이 다른 주기 작업을 막지 않게. yml 의 값이 실제 자동
   * 구성 빈에 닿는지까지 본다.
   */
  @Test
  void 운영_설정은_스케줄러_스레드를_여러개_둔다() {
    runner
        .withConfiguration(AutoConfigurations.of(TaskSchedulingAutoConfiguration.class))
        .withInitializer(
            ctx -> {
              try {
                new YamlPropertySourceLoader()
                    .load("application", new ClassPathResource("application.yml"))
                    .forEach(ps -> ctx.getEnvironment().getPropertySources().addLast(ps));
              } catch (java.io.IOException e) {
                throw new java.io.UncheckedIOException(e);
              }
            })
        .run(
            ctx -> {
              ThreadPoolTaskScheduler scheduler = ctx.getBean(ThreadPoolTaskScheduler.class);
              assertThat(scheduler.getScheduledThreadPoolExecutor().getCorePoolSize()).isEqualTo(4);
              assertThat(scheduler.getThreadNamePrefix()).isEqualTo("sched-");
            });
  }
}
