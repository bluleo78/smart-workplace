package com.workplace.architecture;

import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.lang.annotation.Annotation;
import java.lang.reflect.AnnotatedElement;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.ResourceBundle;
import java.util.stream.Stream;
import org.hibernate.validator.HibernateValidator;
import org.junit.jupiter.api.Test;

/**
 * WP-684 — 요청 검증이 실패하면 웹은 첫 필드 오류 문구를 그대로 토스트로 보인다. 제약에 message 가 없으면 Hibernate Validator 기본
 * 영문(「size must be between 1 and 4000」)이 나왔다.
 *
 * <ul>
 *   <li>표준 제약의 기본 문구는 앱 {@code ValidationMessages.properties} 가 한국어로 덮는다.
 *   <li>message 를 직접 쓴 제약은 한국어여야 한다 — 영문 문구가 새로 들어오면 이 테스트가 막는다.
 * </ul>
 */
class ValidationMessageKoreanTest {

  private static final java.util.regex.Pattern HANGUL = java.util.regex.Pattern.compile("[가-힣]");

  // 운영 서버는 요청 로케일(브라우저 Accept-Language)이나 JVM 기본 로케일이 영어일 수 있다 — 영어 로케일에서도 한국어가 나와야 한다.
  private final Validator validator =
      Validation.byProvider(HibernateValidator.class)
          .configure()
          .defaultLocale(Locale.ENGLISH)
          .buildValidatorFactory()
          .getValidator();

  record Sample(
      @NotBlank String name,
      @Size(max = 4000) String body,
      @Size(min = 1, max = 80) String title,
      @Size(min = 8) String password,
      @NotNull Long id,
      @Email String email,
      @Pattern(regexp = "LOW|MID|HIGH") String priority) {}

  @Test
  void 표준_제약의_기본_문구는_한국어다() {
    Sample bad = new Sample(" ", "가".repeat(4001), "", "short", null, "not-mail", "URGENT");
    List<String> messages =
        validator.validate(bad).stream().map(ConstraintViolation::getMessage).toList();

    assertThat(messages)
        .hasSize(7)
        .allSatisfy(m -> assertThat(m).containsPattern(HANGUL))
        .contains(
            "값을 입력해 주세요",
            "최대 4000까지 입력할 수 있습니다",
            "1~80 사이로 입력해 주세요",
            "최소 8 이상 입력해야 합니다",
            "값이 필요합니다",
            "올바른 이메일 주소가 아닙니다",
            "형식이 올바르지 않습니다");
  }

  @Test
  void 직접_쓴_제약_문구는_한국어이고_기본_문구는_모두_한국어로_덮여_있다() throws Exception {
    ResourceBundle bundle = ResourceBundle.getBundle("ValidationMessages", Locale.ROOT);
    List<String> problems = new ArrayList<>();
    var classes =
        new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.workplace");
    for (var javaClass : classes) {
      Class<?> type;
      try {
        type = javaClass.reflect();
      } catch (Throwable e) {
        continue; // 생성 코드 등 로드할 수 없는 클래스는 건너뛴다
      }
      for (AnnotatedElement element : annotatedElements(type)) {
        for (Annotation a : element.getAnnotations()) {
          if (!a.annotationType().isAnnotationPresent(Constraint.class)) continue;
          String message = messageOf(a);
          if (message == null) continue;
          String where = type.getName() + " " + element + " @" + a.annotationType().getSimpleName();
          if (message.startsWith("{") && message.endsWith("}")) {
            String key = message.substring(1, message.length() - 1);
            if (!bundle.containsKey(key)) problems.add(where + " — 한국어 기본 문구 없음: " + key);
          } else if (!HANGUL.matcher(message).find()) {
            problems.add(where + " — 영문 문구: " + message);
          }
        }
      }
    }
    assertThat(problems).isEmpty();
  }

  private static List<AnnotatedElement> annotatedElements(Class<?> type) {
    List<AnnotatedElement> out = new ArrayList<>();
    try {
      out.addAll(List.of(type.getDeclaredFields()));
      for (Method m : type.getDeclaredMethods()) {
        out.add(m);
        out.addAll(List.of(m.getParameters()));
      }
      Stream.of(type.getDeclaredConstructors())
          .forEach(c -> out.addAll(List.of(c.getParameters())));
    } catch (Throwable ignored) {
      // 의존 클래스가 없어 리플렉션이 실패하는 클래스는 검사 대상이 아니다
    }
    return out;
  }

  private static String messageOf(Annotation a) {
    try {
      return (String) a.annotationType().getMethod("message").invoke(a);
    } catch (ReflectiveOperationException e) {
      return null;
    }
  }
}
