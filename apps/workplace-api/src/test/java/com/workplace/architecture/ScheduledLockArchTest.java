package com.workplace.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods;
import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * 모든 {@code @Scheduled} 작업이 {@code @SchedulerLock} 으로 파드 간 동시 실행을 막는지 강제한다(WP-165).
 *
 * <p>배경: 롤링 배포로 신·구 api 파드가 겹치는 동안 잠금 없는 스케줄러는 파드마다 동시에 돈다(리마인더 이중 발송 등). 새 스케줄러를 추가하며 잠금을 빠뜨리면
 * 운영에서 파드가 겹칠 때만 드러나므로 정적 검사로 막는다.
 *
 * <p>예외(사유 필수):
 *
 * <ul>
 *   <li>{@code SseRegistry.sendHeartbeat} — 파드 로컬 SSE 연결에 하트비트를 보낸다. 모든 파드에서 돌아야 한다.
 *   <li>{@code MailReanalysisScheduler.tick} — 전용 실행기에 넘기고 바로 돌아와 잠금이 효과가 없다. 계정 단위 선점(버전 CAS)이 중복을
 *       막는다.
 * </ul>
 */
@AnalyzeClasses(packages = "com.workplace", importOptions = ImportOption.DoNotIncludeTests.class)
public class ScheduledLockArchTest {

  /** 잠금 예외 — "단순클래스명.메서드명". 추가 시 클래스 주석에 사유를 남긴다. */
  private static final Set<String> UNLOCKED =
      Set.of("SseRegistry.sendHeartbeat", "MailReanalysisScheduler.tick");

  /** 운영 클래스 임포트는 비싸다(전체 클래스) — 두 @Test 가 한 번만 임포트해 나눠 쓴다. */
  private static JavaClasses productionClasses;

  private static synchronized Stream<JavaMethod> productionMethods() {
    if (productionClasses == null) {
      productionClasses =
          new ClassFileImporter()
              .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
              .importPackages("com.workplace");
    }
    return productionClasses.stream().flatMap(c -> c.getMethods().stream());
  }

  private static String key(JavaMethod m) {
    return m.getOwner().getSimpleName() + "." + m.getName();
  }

  @ArchTest
  public static final ArchRule 스케줄_작업은_분산_잠금을_건다 =
      methods()
          .that()
          .areAnnotatedWith(Scheduled.class)
          .and(DescribedPredicate.describe("잠금 예외 목록에 없는", m -> !UNLOCKED.contains(key(m))))
          .should()
          .beAnnotatedWith(SchedulerLock.class)
          .because("롤링 배포 중 파드가 겹치면 잠금 없는 스케줄러가 파드마다 동시에 돈다(WP-165)");

  /** 잠금 이름이 겹치면 서로 다른 작업이 한 잠금을 나눠 써 한쪽이 건너뛰어진다 — 이름은 작업마다 유일해야 한다. */
  @Test
  void 잠금_이름은_작업마다_유일하다() {
    List<String> names =
        productionMethods()
            .filter(m -> m.isAnnotatedWith(SchedulerLock.class))
            .map(m -> m.getAnnotationOfType(SchedulerLock.class).name())
            .toList();
    Map<String, Long> counts =
        names.stream().collect(Collectors.groupingBy(Function.identity(), Collectors.counting()));
    assertThat(names).isNotEmpty();
    assertThat(counts).allSatisfy((name, count) -> assertThat(count).as(name).isEqualTo(1L));
  }

  /** 예외 목록이 실제 메서드를 가리키는지 — 이름이 바뀌어 예외가 허공을 가리키면 새 메서드가 몰래 예외를 얻는 것과 같다. */
  @Test
  void 잠금_예외는_실제_스케줄_작업이다() {
    Set<String> scheduled =
        productionMethods()
            .filter(m -> m.isAnnotatedWith(Scheduled.class))
            .map(ScheduledLockArchTest::key)
            .collect(Collectors.toSet());
    assertThat(scheduled).containsAll(UNLOCKED);
  }
}
