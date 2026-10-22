package com.workplace.global.time;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import java.time.Instant;
import java.time.OffsetDateTime;

/** {@link SupportedDateTime} 검사 — Instant 와 OffsetDateTime 을 같은 UTC 범위로 본다. */
public class SupportedDateTimeValidator implements ConstraintValidator<SupportedDateTime, Object> {

  @Override
  public boolean isValid(Object value, ConstraintValidatorContext context) {
    if (value instanceof Instant instant) {
      return SupportedDates.isSupported(instant);
    }
    if (value instanceof OffsetDateTime odt) {
      return SupportedDates.isSupported(odt.toInstant());
    }
    return true;
  }
}
