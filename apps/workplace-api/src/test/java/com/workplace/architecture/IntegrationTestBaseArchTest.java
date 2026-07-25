package com.workplace.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import com.workplace.support.IntegrationTestBase;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * 통합 테스트가 {@code @SpringBootTest} 를 직접 달지 않고 반드시 {@link IntegrationTestBase} 를 상속하도록 강제한다.
 *
 * <p>배경(#740): Testcontainers 전환(127ef99f) 때 7개 클래스가 누락돼 맨 {@code @SpringBootTest} +
 * {@code @ActiveProfiles("test")} 조합으로 남았다. 그러면 {@link IntegrationTestBase} 의
 * {@code @DynamicPropertySource} 오버라이드를 못 받아 {@code application-test.yml} 의 폴백 URL(제거된 고정 포트 5435)로
 * 접속을 시도하고, ApplicationContext 로드가 실패해 클래스 내 전체 테스트가 죽는다. 21건이 이렇게 실패하고 있었는데, 개별 패키지만 골라 돌리면 드러나지
 * 않아 오래 방치됐다.
 *
 * <p>{@link IntegrationTestBase} 는 URL 오버라이드 외에도 RLS GUC(app.tenant_id) 선주입(#512)·세션 GUC 자가치유·
 * {@code cleanupInTenant} 헬퍼를 제공한다 — 직접 {@code @SpringBootTest} 를 달면 이 안전장치들이 통째로 빠진다.
 *
 * <p>DB 가 필요 없는 슬라이스 테스트를 새로 만들 일이 생기면 {@code @SpringBootTest} 대신 {@code @WebMvcTest} 등 목적에 맞는 슬라이스
 * 애노테이션을 쓰거나, 이 규칙에 명시적 예외를 추가하고 사유를 남긴다.
 */
@AnalyzeClasses(packages = "com.workplace", importOptions = ImportOption.OnlyIncludeTests.class)
public class IntegrationTestBaseArchTest {

  @ArchTest
  static final ArchRule 통합테스트는_IntegrationTestBase_를_상속한다 =
      classes()
          .that()
          .areAnnotatedWith(SpringBootTest.class)
          // IntegrationTestBase 를 제외하지 않는다 — 자기 자신은 assignableTo 를 만족하므로 통과하고,
          // 제외하면 정상 상태에서 매칭 0건이 되어 ArchUnit 이 "빈 규칙"으로 실패한다.
          .should()
          .beAssignableTo(IntegrationTestBase.class)
          .because(
              "맨 @SpringBootTest 는 Testcontainers URL 오버라이드와 RLS GUC 선주입을 놓쳐 폴백 포트 5435 로 붙다 실패한다(#740)");
}
