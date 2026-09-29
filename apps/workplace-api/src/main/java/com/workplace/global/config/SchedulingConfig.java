package com.workplace.global.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * {@code @Scheduled} 작업(메일 자동 동기화·알림 리마인더·정리 잡 등) 활성화.
 *
 * <p>{@code workplace.scheduling.enabled=false} 로 끌 수 있다(기본 켜짐). 테스트 프로파일은 끈다 — 테스트 컨텍스트는 목 조합별로 수십
 * 개가 캐시되어 동시에 살아 있는데, 컨텍스트마다 스케줄러가 돌면 테스트가 만든 계정으로 실제 외부 API(Graph 등)를 호출하고 테스트 데이터와 경합해 느려지고 비결정적이
 * 된다(WP-80). 스케줄러 로직은 각 테스트가 메서드를 직접 호출해 검증한다.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(
    name = "workplace.scheduling.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class SchedulingConfig {}
