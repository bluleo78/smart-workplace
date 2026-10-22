package com.workplace.global.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 본문에 화면에 그려지는 글자가 하나라도 있어야 한다(WP-777) — 공백뿐인 본문은 {@code @NotBlank} 가 막지만 제로폭 문자·점자 빈칸·한글 채움 문자만 있는
 * 본문은 통과해 빈 말풍선이 생겼다. null 은 통과시킨다(필수 여부는 {@code @NotBlank} 등이 따로 본다). 줄바꿈 같은 본문 내용은 바꾸지 않고 검사만 한다.
 */
@Documented
@Constraint(validatedBy = VisibleTextValidator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
public @interface VisibleText {
  String message() default "내용을 입력해 주세요";

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};
}
