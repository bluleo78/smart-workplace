package com.workplace.auth.sso;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * SSO 통합 테스트 공통 베이스(WP-48) — authority 를 JVM 싱글턴 가짜 IdP 로 덮어쓴다. 모든 SSO 테스트가 같은 값을 쓰므로 Spring 컨텍스트는
 * 하나로 공유된다.
 */
public abstract class SsoIntegrationTestBase extends IntegrationTestBase {

  protected static final FakeEntraProvider FAKE = FakeEntraProvider.INSTANCE;

  @DynamicPropertySource
  static void ssoAuthority(DynamicPropertyRegistry registry) {
    registry.add("workplace.auth.sso.m365.authority-base-url", FAKE::authority);
  }

  @BeforeEach
  void resetFakeIdp() {
    FAKE.reset();
  }
}
