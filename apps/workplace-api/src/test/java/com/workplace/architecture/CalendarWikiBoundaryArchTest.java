package com.workplace.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

/**
 * calendar 가 wiki 에서 쓰는 것은 읽기 포트 {@code WikiPageReadAccess} 와 카드 {@code WikiPageCard} 와 노트 없음
 * 예외뿐이다(WP-1701). 노트 권한 판정을 calendar 가 따로 흉내 내지 않게 — 포트 밖 wiki 타입(저장소·권한 서비스 등)에 의존하면 막는다.
 */
@AnalyzeClasses(packages = "com.workplace", importOptions = ImportOption.DoNotIncludeTests.class)
public class CalendarWikiBoundaryArchTest {

  /** calendar 가 의존해도 되는 wiki 타입. */
  private static boolean allowedWikiType(JavaClass c) {
    return c.getName().equals("com.workplace.wiki.service.WikiPageReadAccess")
        || c.getName().equals("com.workplace.wiki.dto.WikiPageCard")
        || c.getName().equals("com.workplace.wiki.exception.WikiPageNotFoundException");
  }

  @ArchTest
  static final ArchRule calendar_은_wiki_의_읽기_포트만_쓴다 =
      classes()
          .that()
          .resideInAPackage("com.workplace.calendar..")
          .should()
          .onlyDependOnClassesThat(
              new com.tngtech.archunit.base.DescribedPredicate<JavaClass>(
                  "wiki 가 아니거나 허용된 wiki 타입") {
                @Override
                public boolean test(JavaClass c) {
                  return !c.getPackageName().startsWith("com.workplace.wiki") || allowedWikiType(c);
                }
              });
}
