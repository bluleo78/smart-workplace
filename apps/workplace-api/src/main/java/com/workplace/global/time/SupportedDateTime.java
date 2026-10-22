package com.workplace.global.time;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 요청의 시각(Instant·OffsetDateTime)을 날짜와 같은 지원 범위(1900-01-01 ~ 9999-12-31, UTC)로 제한한다(WP-744).
 *
 * <p>날짜(LocalDate)는 요청 본문 해석기가 한곳에서 막는다(WP-725). 시각은 같은 ObjectMapper 가 외부 API 응답(메일·캘린더 동기화)도 읽어
 * 해석기에서 막으면 그쪽이 깨질 수 있어, 사용자가 보내는 요청 DTO 의 칸에만 이 제약을 둔다. 0년이나 {@code +99999-01-01T00:00:00Z} 같은 확장
 * 연도가 저장돼 다른 클라이언트가 해석하지 못하는 값으로 돌아오던 것을 막는다. null 은 통과한다(필수는 {@code @NotNull} 로).
 */
@Target({
  ElementType.FIELD,
  ElementType.PARAMETER,
  ElementType.RECORD_COMPONENT,
  ElementType.TYPE_USE
})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = SupportedDateTimeValidator.class)
public @interface SupportedDateTime {
  String message() default SupportedDates.MESSAGE;

  Class<?>[] groups() default {};

  Class<? extends Payload>[] payload() default {};
}
