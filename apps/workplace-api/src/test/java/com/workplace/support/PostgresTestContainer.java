package com.workplace.support;

import org.testcontainers.containers.PostgreSQLContainer;

/**
 * JVM 전역 단일 Postgres(+pgvector) 테스트 컨테이너.
 *
 * <p>순수 {@code static final} 싱글턴 — Spring {@code @Bean}/{@code @ServiceConnection} 으로 노출하지 않는다.
 * workplace 는 datasource 가 이중 롤(Flyway=소유자 app, 런타임=app_tenant RLS 강제)이라 {@code @ServiceConnection}
 * 이 주 datasource 를 슈퍼유저 app(BYPASSRLS)에 배선하면 테넌트 격리 테스트가 RLS 없이 조용히 통과(오탐)한다. URL 만 {@link
 * IntegrationTestBase} 의 {@code @DynamicPropertySource} 로 주입하고, 롤/풀/GUC 는 application-test.yml 을
 * 그대로 쓴다. Bean 이 아니므로 컨텍스트 eviction 시 close() 로 공유 컨테이너가 죽는 함정도 없다(Ryuk 이 JVM 종료 시 정리).
 */
public final class PostgresTestContainer {

  /** 슈퍼유저 app = 소유자(마이그레이션). app_tenant 런타임 롤은 V44 마이그레이션이 생성한다. */
  public static final PostgreSQLContainer<?> INSTANCE =
      new PostgreSQLContainer<>("pgvector/pgvector:pg18")
          .withDatabaseName("workplace_test")
          .withUsername("app")
          .withPassword("app")
          // 다수 @SpringBootTest 컨텍스트 캐시 × Hikari 풀 누적으로 인한 too many clients 방지.
          .withCommand("postgres", "-c", "max_connections=200");

  static {
    // docker-java 기본 API 협상(1.32)을 OrbStack 등 모던 데몬이 거부 → 1.41 로 고정.
    System.setProperty("api.version", "1.41");
    INSTANCE.start(); // static init 에서 1회 기동, 명시적 중지 없음(Ryuk 정리).
  }

  private PostgresTestContainer() {}
}
