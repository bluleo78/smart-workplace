package com.workplace.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import com.workplace.global.json.JsonMappers;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.json.JsonMapper;

/**
 * main 코드가 Jackson 2 의 databind·core({@code com.fasterxml.jackson.databind..}·{@code
 * com.fasterxml.jackson.core..}) 에 의존하지 않게 한다(WP-1609).
 *
 * <p>Jackson 3 로 옮긴 뒤 컴파일 classpath 에서는 빠졌지만, 테스트·전이 의존이 Jackson 2 를 다시 끌어오면 옛 import 가 조용히 컴파일돼 두
 * 매퍼가 섞인다. 어노테이션({@code com.fasterxml.jackson.annotation..})은 Jackson 3 도 그대로 쓰므로 허용한다.
 */
@AnalyzeClasses(packages = "com.workplace", importOptions = ImportOption.DoNotIncludeTests.class)
class JacksonArchTest {

  @ArchTest
  static final ArchRule main_코드는_Jackson2_databind_core_에_의존하지_않는다 =
      noClasses()
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage("com.fasterxml.jackson.databind..", "com.fasterxml.jackson.core..")
          .because("Jackson 3(tools.jackson)으로 전환했다 — Jackson 2 매퍼가 섞이면 응답·요청 해석이 갈린다(WP-1609)");

  /**
   * 직접 만드는 매퍼는 {@link JsonMappers} 를 거친다(WP-1609) — {@code builderWithJackson2Defaults()}·{@code
   * builder()} 로 따로 만들면 Jackson 3 기본 크기 한도(문자열 100,000,000자·중첩 500 단계)가 돼 Jackson 2 때와 달라진다.
   */
  @ArchTest
  static final ArchRule 매퍼는_JsonMappers_에서만_만든다 =
      noClasses()
          .that()
          .doNotBelongToAnyOf(JsonMappers.class)
          .should()
          .callMethod(JsonMapper.class, "builderWithJackson2Defaults")
          .orShould()
          .callMethod(JsonMapper.class, "builder")
          .orShould()
          .callMethod(JsonMapper.class, "builder", JsonFactory.class)
          .orShould()
          .callMethod(JsonFactory.class, "builderWithJackson2Defaults")
          .because("Jackson 2 크기 한도를 빠뜨린 매퍼가 생기지 않게 한 곳(JsonMappers)에서 만든다(WP-1609)");
}
