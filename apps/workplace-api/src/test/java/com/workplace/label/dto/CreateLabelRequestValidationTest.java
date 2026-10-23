package com.workplace.label.dto;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

/** WP-850: 라벨 이름 40자 초과는 어느 칸·무슨 단위인지 밝힌 문구로 거절한다(공용 「최대 40까지」 대신). */
class CreateLabelRequestValidationTest {

  private static final Validator VALIDATOR =
      Validation.buildDefaultValidatorFactory().getValidator();

  @Test
  void 이름이_40자를_넘으면_이름과_단위를_밝혀_거절한다() {
    var violations = VALIDATOR.validate(new CreateLabelRequest("가".repeat(41), "GRAY"));
    assertThat(violations)
        .extracting(ConstraintViolation::getMessage)
        .containsExactly("라벨 이름은 40자까지 입력할 수 있습니다");
  }

  @Test
  void 이름이_40자면_통과한다() {
    assertThat(VALIDATOR.validate(new CreateLabelRequest("가".repeat(40), "GRAY"))).isEmpty();
  }
}
