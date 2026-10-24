package com.workplace;

import java.util.TimeZone;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/** Gen:iA Works API 진입점. 스케줄링 활성화는 {@link com.workplace.global.config.SchedulingConfig} 참조. */
@SpringBootApplication
@ConfigurationPropertiesScan
public class WorkplaceApplication {

  public static void main(String[] args) {
    useUtcDefaultTimeZone();
    SpringApplication.run(WorkplaceApplication.class, args);
  }

  /**
   * JVM 기본 시간대를 UTC 로 고정한다(WP-939). pgjdbc 가 DB 세션 TimeZone 을 JVM 기본 시간대로 맞추므로, 시간대 없는 TIMESTAMP
   * 칼럼의 {@code DEFAULT NOW()} 와 {@code LocalDateTime.now()} 가 실행 환경(로컬 KST·운영 UTC)에 따라 다른 벽시계로
   * 저장됐다. 운영 이미지 기본값인 UTC 로 어디서나 같게 맞춘다 — 커넥션 풀이 열리기 전에 불러야 한다.
   */
  static void useUtcDefaultTimeZone() {
    TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
  }
}
