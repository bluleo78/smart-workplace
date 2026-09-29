package com.workplace.global.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.RegexPatternTypeFilter;

/**
 * resource.changed 리소스 이름 계약 테스트 (WP-36). 백엔드 *ChangeNotifier 의 {@code RESOURCE_*} 상수 집합이 프론트 무효화 맵
 * 키 목록 ({@code apps/workplace-web/src/lib/resource-contract.json}) 과 정확히 같은지 확인한다 — 한쪽에만 리소스를 추가하면
 * 이벤트가 무시되거나 규칙이 죽은 코드가 되는 것을 CI 에서 잡기 위함. 웹 쪽은 resourceInvalidation.test.ts 가 같은 JSON 과 RULES 키를
 * 비교한다. Spring 컨텍스트 없이 클래스패스 스캔 + 리플렉션만 쓴다.
 */
@DisplayName("resource.changed 리소스 이름 — 백엔드 notifier 상수 ↔ 웹 계약 JSON 일치")
class ResourceChangedContractTest {

  /** gradle 테스트 작업 디렉터리(apps/workplace-api) 기준 웹 계약 파일 경로. */
  private static final Path CONTRACT = Path.of("../workplace-web/src/lib/resource-contract.json");

  @Test
  void notifierResourceConstants_matchWebContract() throws Exception {
    Set<String> backend = collectNotifierResources();
    List<String> web =
        new ObjectMapper().readValue(Files.readString(CONTRACT), new TypeReference<>() {});

    assertThat(backend).as("RESOURCE_* 상수가 하나도 수집되지 않음 — 스캔 경로 확인").isNotEmpty();
    assertThat(backend).containsExactlyInAnyOrderElementsOf(new TreeSet<>(web));
  }

  /** com.workplace 하위 *ChangeNotifier 클래스의 public static final String RESOURCE_* 값을 모은다. */
  private static Set<String> collectNotifierResources() throws Exception {
    var scanner = new ClassPathScanningCandidateComponentProvider(false);
    scanner.addIncludeFilter(new RegexPatternTypeFilter(Pattern.compile(".*ChangeNotifier")));
    Set<String> names = new TreeSet<>();
    for (BeanDefinition bd : scanner.findCandidateComponents("com.workplace")) {
      for (Field f : Class.forName(bd.getBeanClassName()).getDeclaredFields()) {
        int m = f.getModifiers();
        if (f.getName().startsWith("RESOURCE_")
            && f.getType() == String.class
            && Modifier.isPublic(m)
            && Modifier.isStatic(m)
            && Modifier.isFinal(m)) {
          names.add((String) f.get(null));
        }
      }
    }
    return names;
  }
}
