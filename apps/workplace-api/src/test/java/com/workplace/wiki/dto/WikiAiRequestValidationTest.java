package com.workplace.wiki.dto;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.util.Set;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/** 노트 AI 요청의 지시문 상한(WP-674) — 4000자를 넘으면 한국어 문구로 거절하고, selection 은 상한을 두지 않는다. */
class WikiAiRequestValidationTest {

  private static final ValidatorFactory FACTORY = Validation.buildDefaultValidatorFactory();
  private static final Validator VALIDATOR = FACTORY.getValidator();

  @AfterAll
  static void close() {
    FACTORY.close();
  }

  @Test
  void 지시문이_4000자를_넘으면_거절_selection_은_길어도_통과() {
    assertThat(VALIDATOR.validate(new WikiAiRequest(WikiAiAction.DRAFT, "가".repeat(4000), null)))
        .isEmpty();

    Set<ConstraintViolation<WikiAiRequest>> v =
        VALIDATOR.validate(new WikiAiRequest(WikiAiAction.DRAFT, "가".repeat(4001), null));
    assertThat(v).hasSize(1);
    assertThat(v.iterator().next().getMessage()).isEqualTo("지시문은 4000자 이하로 입력해 주세요");

    assertThat(VALIDATOR.validate(new WikiAiRequest(WikiAiAction.DRAFT, null, "본".repeat(50_000))))
        .isEmpty();
  }
}
