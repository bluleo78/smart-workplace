package com.workplace.architecture;

import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.workplace.global.security.RequireAgent;
import java.lang.reflect.AnnotatedElement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * AI 키 전용 경로({@code /api/v1/agent-runtime/me} 아래)의 핸들러가 {@link RequireAgent} 를 다는지(클래스나 메서드)
 * 강제한다(WP-1286).
 *
 * <p>배경: 메서드마다 AI 여부를 직접 검사하던 때는 새 API 에서 한 줄을 빠뜨리면 사람 토큰으로도 열렸고 컴파일·테스트가 잡지 못했다. 경로는 클래스 매핑과 메서드
 * 매핑을 이어 붙여 본다 — 클래스는 {@code /api/v1/agent-runtime} 이고 메서드가 {@code /me/...} 인 경우도 잡는다.
 */
@AnalyzeClasses(packages = "com.workplace", importOptions = ImportOption.DoNotIncludeTests.class)
public class AgentOnlyApiArchTest {

  /** AI 자신만 부르는 경로 접두. */
  private static final String AGENT_ME_PREFIX = "/api/v1/agent-runtime/me";

  /**
   * 매핑 경로들 — @GetMapping 등은 @RequestMapping 을 메타 애노테이션으로 가지므로 병합해 한 번에 읽는다. 매핑이 아니면 null, 경로가 없는
   * 매핑이면 빈 문자열 하나.
   */
  private static List<String> paths(AnnotatedElement element) {
    RequestMapping m = AnnotatedElementUtils.findMergedAnnotation(element, RequestMapping.class);
    if (m == null) return null;
    List<String> all =
        Stream.concat(Arrays.stream(m.value()), Arrays.stream(m.path())).distinct().toList();
    return all.isEmpty() ? List.of("") : all;
  }

  /** 경로 둘을 이어 붙인다(사이 / 하나). */
  private static String join(String a, String b) {
    if (b.isEmpty()) return a;
    return a.replaceAll("/+$", "") + (b.startsWith("/") ? b : "/" + b);
  }

  /** {@code /api/v1/agent-runtime/me} 아래 핸들러는 클래스나 메서드에 {@code @RequireAgent} 를 단다. */
  @ArchTest
  static void agentMeHandlersRequireAgent(JavaClasses classes) {
    List<String> missing = new ArrayList<>();
    int checked = 0;
    for (JavaClass c : classes) {
      boolean classMarked = c.isAnnotatedWith(RequireAgent.class);
      List<String> classPaths = paths(c.reflect());
      for (JavaMethod m : c.getMethods()) {
        List<String> mp = paths(m.reflect());
        if (mp == null) continue;
        for (String cp : classPaths == null ? List.of("") : classPaths) {
          for (String p : mp) {
            String full = join(cp, p);
            if (!full.equals(AGENT_ME_PREFIX) && !full.startsWith(AGENT_ME_PREFIX + "/")) continue;
            checked++;
            if (!classMarked && !m.isAnnotatedWith(RequireAgent.class)) {
              missing.add(c.getSimpleName() + "." + m.getName() + " " + full);
            }
          }
        }
      }
    }
    // 검사 대상이 하나도 없으면 경로 해석이 깨진 것이다 — 조용히 통과하지 않게.
    assertThat(checked).as("/agent-runtime/me 핸들러를 찾지 못했다").isPositive();
    assertThat(missing).as("@RequireAgent 가 없는 AI 전용 핸들러").isEmpty();
  }
}
