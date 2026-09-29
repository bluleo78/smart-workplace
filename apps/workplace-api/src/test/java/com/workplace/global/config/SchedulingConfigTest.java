package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.annotation.ScheduledAnnotationBeanPostProcessor;

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
}
