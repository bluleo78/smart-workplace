package com.workplace.global.time;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;

/**
 * {@link SupportedDateTime} 검사 — Instant 와 OffsetDateTime 을 같은 UTC 범위로 본다. LocalDateTime(감사 로그 기간
 * 쿼리 등)은 날짜 부분으로 같은 범위를 본다(WP-899).
 */
public class SupportedDateTimeValidator implements ConstraintValidator<SupportedDateTime, Object> {

  @Override
  public boolean isValid(Object value, ConstraintValidatorContext context) {
    if (value instanceof Instant instant) {
      return SupportedDates.isSupported(instant);
    }
    if (value instanceof OffsetDateTime odt) {
      return SupportedDates.isSupported(odt.toInstant());
    }
    if (value instanceof LocalDateTime ldt) {
      return SupportedDates.isSupported(ldt.toLocalDate());
    }
    return true;
  }
}
