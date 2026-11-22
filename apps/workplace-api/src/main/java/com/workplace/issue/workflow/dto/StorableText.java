package com.workplace.issue.workflow.dto;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 그대로 저장할 수 있는 글(NUL·짝 없는 서로게이트 없음)만 받는 제약. null 은 통과한다(필수는 {@code @NotNull} 로).
 *
 * <p>왜: NUL 은 DB 가 거절하고, 짝 없는 서로게이트는 DB 드라이버에서 조용히 다른 글자로 바뀔 수 있다. 저장하는 칸(이름·YAML)에만 붙인다 — 검증만 하는
 * 요청은 파서가 줄·열이 든 문제로 알려야 하므로 붙이지 않는다.
 */
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = StorableText.Validator.class)
public @interface StorableText {
  /** 필드 오류로 그대로 보이는 한국어 안내. */
  String message() default "저장할 수 없는 문자(NUL 또는 깨진 문자)가 들어 있습니다";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};

  /** {@link StorableText} 판정. */
  class Validator implements ConstraintValidator<StorableText, String> {

    /** null 은 통과, 그 밖은 {@link #isStorable}. */
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
      return value == null || isStorable(value);
    }

    /**
     * NUL 과 짝 없는 서로게이트가 없는가 — codePoints() 는 짝 없는 서로게이트만 서로게이트 값 그대로 돌려준다. 파서도 이 판정을 써서 「저장은 되는데
     * 파서가 거절」(또는 그 반대)로 갈리지 않게 한다.
     */
    public static boolean isStorable(String value) {
      return value
          .codePoints()
          .noneMatch(c -> c == 0 || (c >= Character.MIN_SURROGATE && c <= Character.MAX_SURROGATE));
    }
  }
}
