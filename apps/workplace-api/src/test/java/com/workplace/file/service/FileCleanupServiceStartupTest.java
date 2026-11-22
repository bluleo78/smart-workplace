package com.workplace.file.service;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.annotation.PostConstruct;
import java.util.Arrays;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;

/** 기동 때 파일 정리 제거(WP-1981) — 정리는 예약과 잠금으로만 돈다는 계약을 고정한다. */
class FileCleanupServiceStartupTest {

  @Test
  void 기동_때_정리를_부르지_않고_예약과_잠금으로만_돈다() throws NoSuchMethodException {
    assertThat(
            Arrays.stream(FileCleanupService.class.getDeclaredMethods())
                .anyMatch(m -> m.isAnnotationPresent(PostConstruct.class)))
        .as("@PostConstruct 가 붙으면 ShedLock 을 건너뛰고 모든 파드에서 기동 때 돈다")
        .isFalse();

    var scheduled = FileCleanupService.class.getDeclaredMethod("cleanupExpiredFiles");
    assertThat(scheduled.getAnnotation(Scheduled.class)).isNotNull();
    assertThat(scheduled.getAnnotation(SchedulerLock.class)).isNotNull();
  }
}
