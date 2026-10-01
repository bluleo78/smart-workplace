package com.workplace.global.config;

import javax.sql.DataSource;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 스케줄러 분산 잠금(ShedLock, WP-165) — {@code @SchedulerLock} 이 붙은 {@code @Scheduled} 작업은 {@code
 * shedlock} 테이블의 작업 이름별 잠금을 먼저 잡은 파드 하나만 실행하고, 나머지 파드는 그 회차를 건너뛴다(대기하지 않음).
 *
 * <p>왜: 롤링 배포로 신·구 api 파드가 겹치는 동안(또는 replicas ≥ 2) 스케줄러가 파드마다 동시에 돌면 리마인더 이중 발송·메일 동기화 중복·LLM 중복
 * 호출이 생긴다. 잠금은 "동시 실행"만 막는다 — 주기 안에서 파드마다 시차를 두고 한 번씩 도는 것까지 막지는 않으므로, 각 작업은 지금처럼 DB 상태 기준으로 멱등해야
 * 한다.
 *
 * <ul>
 *   <li>{@code usingDbTime()}: 잠금 만료를 DB 시각으로 판정 — 파드 간 시계 차이에 영향받지 않는다.
 *   <li>기본 lockAtMostFor 30분: 잠금을 잡은 파드가 작업 중 죽어도 30분 뒤 자동 해제. 작업이 이보다 오래 걸리면 잠금이 먼저 풀려 다른 파드가 겹쳐 돌
 *       수 있으므로 넉넉히 잡았다. 주기가 짧아 오래 막히면 안 되는 작업(리마인더)은 메서드에서 줄인다.
 *   <li>기본 lockAtLeastFor 10초: 거의 동시에 깨어난 다른 파드가 막 끝난 작업을 바로 다시 잡지 않게 한다.
 * </ul>
 *
 * <p>{@code workplace.scheduling.lock-enabled=false} 로 끌 수 있다(기본 켜짐). 테스트 프로파일은 끈다 — 잠금 AOP 가 켜지면
 * 테스트가 스케줄러 메서드를 연달아 직접 호출할 때 두 번째 호출이 lockAtLeastFor 에 막혀 조용히 건너뛰어진다. 잠금 동작은 전용 테스트가 켜서 검증한다.
 */
@Configuration
@EnableSchedulerLock(defaultLockAtMostFor = "PT30M", defaultLockAtLeastFor = "PT10S")
@ConditionalOnProperty(
    name = "workplace.scheduling.lock-enabled",
    havingValue = "true",
    matchIfMissing = true)
public class SchedulerLockConfig {

  /** JDBC 잠금 제공자 — 런타임 datasource(app_tenant) 로 {@code shedlock}(비-RLS) 행을 갱신한다. 트랜잭션 밖 자동 커밋. */
  @Bean
  public LockProvider lockProvider(DataSource dataSource) {
    return new JdbcTemplateLockProvider(
        JdbcTemplateLockProvider.Configuration.builder()
            .withJdbcTemplate(new JdbcTemplate(dataSource))
            .usingDbTime()
            .build());
  }
}
