package com.workplace.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.lang.annotation.Annotation;
import java.util.List;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * 컨트롤러가 리포지토리를 직접 주입받아 서비스 레이어 없이 호출하는 경로에 {@code @Transactional} 이 빠지면
 * TenantAwareTransactionManager 가 tenant GUC(app.tenant_id) 를 주입하지 않아 RLS 가 fail-closed 로 전 행을
 * 가려버린다(항상 404). 이 리포에서 최소 3번째 재발(#444 메일 요약, #492 홈 confirm, #630 의존 엣지 API) — 매번 라이브 스모크에서만 드러났고
 * IntegrationTestBase 의 클래스 레벨 {@code @Transactional} 이 테스트에서는 GUC 를 미리 심어줘 결함을 가려 왔다. 이 정적 검사로 재발을
 * 원천 차단한다(#640).
 */
@AnalyzeClasses(packages = "com.workplace", importOptions = ImportOption.DoNotIncludeTests.class)
public class RlsTransactionalArchTest {

  @SuppressWarnings("unchecked")
  private static final List<Class<? extends Annotation>> REQUEST_MAPPING_ANNOTATIONS =
      List.of(
          GetMapping.class,
          PostMapping.class,
          PutMapping.class,
          PatchMapping.class,
          DeleteMapping.class,
          RequestMapping.class);

  private static boolean isHandlerMethod(JavaMethod method) {
    return REQUEST_MAPPING_ANNOTATIONS.stream().anyMatch(method::isAnnotatedWith);
  }

  private static boolean ownerInjectsRepository(JavaClass owner) {
    return owner.getFields().stream()
        .anyMatch(field -> field.getRawType().getSimpleName().endsWith("Repository"));
  }

  private static boolean isTransactional(JavaMethod method) {
    return method.isAnnotatedWith(Transactional.class)
        || method.getOwner().isAnnotatedWith(Transactional.class);
  }

  @ArchTest
  public static final ArchRule controller_handlers_that_inject_a_repository_must_be_transactional =
      methods()
          .that(
              new com.tngtech.archunit.base.DescribedPredicate<JavaMethod>(
                  "are Spring MVC 핸들러이면서 소속 클래스가 Repository 를 직접 주입받음") {
                @Override
                public boolean test(JavaMethod method) {
                  return isHandlerMethod(method) && ownerInjectsRepository(method.getOwner());
                }
              })
          .should(
              new ArchCondition<JavaMethod>("@Transactional 이 메서드 또는 선언 클래스에 있어야 한다") {
                @Override
                public void check(
                    JavaMethod method, com.tngtech.archunit.lang.ConditionEvents events) {
                  if (!isTransactional(method)) {
                    events.add(
                        SimpleConditionEvent.violated(
                            method,
                            method.getFullName()
                                + " 는 Repository 를 직접 주입받는 컨트롤러의 핸들러인데 @Transactional 이 없다 — "
                                + "TenantAwareTransactionManager 가 tenant GUC 를 주입하지 못해 RLS 가 fail-closed 될 수 있다."));
                  }
                }
              })
          .because(
              "리포지토리를 직접 호출하는 컨트롤러 핸들러는 @Transactional 이 없으면 tenant GUC 미주입으로 RLS 가 "
                  + "fail-closed 된다(#444, #492, #630 재발 방지 — #640)");
}
