package com.workplace.global.validation;

import com.workplace.global.util.PersonNames;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/** {@link VisibleText} 검사기 — 그려지는 글자 판정은 이름·제목과 같은 기준({@link PersonNames#hasVisibleChar})을 쓴다. */
public class VisibleTextValidator implements ConstraintValidator<VisibleText, String> {
  @Override
  public boolean isValid(String value, ConstraintValidatorContext context) {
    return value == null || PersonNames.hasVisibleChar(value);
  }
}
