package com.workplace.issue.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.exception.InvalidFieldOptionsException;
import com.workplace.issue.exception.InvalidFieldTypeException;
import com.workplace.issue.exception.InvalidFieldValueException;
import org.junit.jupiter.api.Test;

/** FieldType / FieldTypeValidator — 5 타입 화이트리스트와 options/value 검증 dispatcher. */
class FieldTypeValidatorTest {

  private final ObjectMapper om = new ObjectMapper();

  @Test
  void valid_types_accepted() {
    for (String t : new String[] {"TEXT", "NUMBER", "DATE", "SELECT", "MULTI_SELECT"}) {
      assertThat(FieldType.validate(t)).isEqualTo(t);
    }
  }

  @Test
  void unknown_type_throws() {
    assertThatThrownBy(() -> FieldType.validate("EMAIL"))
        .isInstanceOf(InvalidFieldTypeException.class);
  }

  @Test
  void options_required_for_select_and_multi_select() {
    // 메시지에 영문 enum(SELECT)이 아닌 한국어 레이블(선택)이 노출돼야 한다 (#805).
    assertThatThrownBy(() -> FieldTypeValidator.normalizeOptions("SELECT", null))
        .isInstanceOf(InvalidFieldOptionsException.class)
        .hasMessageContaining("선택 필드는 최소 1개 이상의 옵션이 필요합니다")
        .hasMessageNotContaining("SELECT");
    assertThatThrownBy(
            () -> FieldTypeValidator.normalizeOptions("MULTI_SELECT", om.createArrayNode()))
        .isInstanceOf(InvalidFieldOptionsException.class)
        .hasMessageContaining("복수 선택 필드는 최소 1개 이상의 옵션이 필요합니다")
        .hasMessageNotContaining("MULTI_SELECT");
  }

  @Test
  void options_forbidden_for_text_number_date() {
    var arr = om.createArrayNode().add("a");
    assertThatThrownBy(() -> FieldTypeValidator.normalizeOptions("TEXT", arr))
        .isInstanceOf(InvalidFieldOptionsException.class)
        .hasMessageContaining("텍스트 필드는 옵션을 지정할 수 없습니다")
        .hasMessageNotContaining("TEXT");
  }

  /** 옵션은 앞뒤 공백·줄바꿈을 지운 값으로 저장하고, 비거나 다듬은 뒤 겹치면 거절한다(WP-610). */
  @Test
  void options_are_trimmed_and_blank_or_duplicate_after_trim_rejected() {
    assertThat(
            FieldTypeValidator.normalizeOptions(
                "SELECT", om.createArrayNode().add("  높음 ").add("낮음\n")))
        .isEqualTo(om.createArrayNode().add("높음").add("낮음"));
    assertThatThrownBy(
            () ->
                FieldTypeValidator.normalizeOptions(
                    "SELECT", om.createArrayNode().add("A").add("   ")))
        .isInstanceOf(InvalidFieldOptionsException.class)
        .hasMessageEndingWith("빈 옵션은 만들 수 없습니다");
    assertThatThrownBy(
            () ->
                FieldTypeValidator.normalizeOptions(
                    "SELECT", om.createArrayNode().add("A").add(" A ")))
        .isInstanceOf(InvalidFieldOptionsException.class)
        .hasMessageEndingWith("중복 옵션: A");
  }

  /** 옵션은 100개까지(WP-610). */
  @Test
  void options_count_is_capped() {
    var ok = om.createArrayNode();
    for (int i = 0; i < 100; i++) ok.add("옵션" + i);
    assertThat(FieldTypeValidator.normalizeOptions("MULTI_SELECT", ok)).hasSize(100);
    var tooMany = ok.deepCopy().add("옵션100");
    assertThatThrownBy(() -> FieldTypeValidator.normalizeOptions("MULTI_SELECT", tooMany))
        .isInstanceOf(InvalidFieldOptionsException.class)
        .hasMessageEndingWith("옵션은 100개까지 만들 수 있습니다");
  }

  /** 다중 선택 값에 같은 옵션을 두 번 넣으면 거절한다(WP-610). */
  @Test
  void multi_select_value_rejects_duplicate_pick() {
    var opts = om.createArrayNode().add("X").add("Y");
    FieldTypeValidator.validateValue("MULTI_SELECT", opts, om.createArrayNode().add("X").add("Y"));
    assertThatThrownBy(
            () ->
                FieldTypeValidator.validateValue(
                    "MULTI_SELECT", opts, om.createArrayNode().add("X").add("X")))
        .isInstanceOf(InvalidFieldValueException.class)
        .hasMessageContaining("같은 옵션을 두 번");
  }

  @Test
  void text_value_must_be_string_under_2000() {
    FieldTypeValidator.validateValue("TEXT", null, om.valueToTree("hello"));
    assertThatThrownBy(() -> FieldTypeValidator.validateValue("TEXT", null, om.valueToTree(42)))
        .isInstanceOf(InvalidFieldValueException.class);
  }

  @Test
  void number_value_must_be_number() {
    FieldTypeValidator.validateValue("NUMBER", null, om.valueToTree(42));
    assertThatThrownBy(() -> FieldTypeValidator.validateValue("NUMBER", null, om.valueToTree("x")))
        .isInstanceOf(InvalidFieldValueException.class);
  }

  @Test
  void date_value_must_be_iso_date_string() {
    FieldTypeValidator.validateValue("DATE", null, om.valueToTree("2026-06-01"));
    assertThatThrownBy(
            () -> FieldTypeValidator.validateValue("DATE", null, om.valueToTree("invalid")))
        .isInstanceOf(InvalidFieldValueException.class);
  }

  @Test
  void select_value_must_be_in_options() {
    var opts = om.createArrayNode().add("a").add("b");
    FieldTypeValidator.validateValue("SELECT", opts, om.valueToTree("a"));
    assertThatThrownBy(() -> FieldTypeValidator.validateValue("SELECT", opts, om.valueToTree("c")))
        .isInstanceOf(InvalidFieldValueException.class);
  }

  @Test
  void multi_select_value_must_be_subset_of_options() {
    var opts = om.createArrayNode().add("a").add("b");
    FieldTypeValidator.validateValue(
        "MULTI_SELECT", opts, om.valueToTree(java.util.List.of("a", "b")));
    assertThatThrownBy(
            () ->
                FieldTypeValidator.validateValue(
                    "MULTI_SELECT", opts, om.valueToTree(java.util.List.of("a", "c"))))
        .isInstanceOf(InvalidFieldValueException.class);
  }

  /** WP-587: 무한대(1e400 → Infinity)·JS 가 정확히 다루지 못하는 큰 수는 거절하고, 범위 안의 유한한 수만 받는다. */
  @Test
  void number_rejects_non_finite_and_out_of_range() throws Exception {
    for (String json :
        new String[] {"1e400", "-1e400", "12345678901234567890123", "9007199254740992"}) {
      assertThatThrownBy(() -> FieldTypeValidator.validateValue("NUMBER", null, om.readTree(json)))
          .as(json)
          .isInstanceOf(InvalidFieldValueException.class)
          .hasMessageContaining("숫자 필드에는 ±9007199254740991 안의 숫자만 쓸 수 있습니다");
    }
    for (String json : new String[] {"3.14", "-9007199254740991", "9007199254740991", "0"}) {
      FieldTypeValidator.validateValue("NUMBER", null, om.readTree(json));
    }
  }

  /** WP-725: DATE 필드는 1900-01-01 ~ 9999-12-31 만 — 큰 연도(+999999999)·음수 연도가 저장되면 이슈 상세가 열리지 않았다. */
  @Test
  void date_outsideSupportedRange_rejected() {
    ObjectMapper om = new ObjectMapper();
    for (String v :
        new String[] {"+10000-01-01", "+999999999-12-31", "-0001-01-01", "1899-12-31"}) {
      assertThatThrownBy(() -> FieldTypeValidator.validateValue("DATE", null, om.valueToTree(v)))
          .isInstanceOf(InvalidFieldValueException.class)
          .hasMessageContaining("1900-01-01 ~ 9999-12-31");
    }
    FieldTypeValidator.validateValue("DATE", null, om.valueToTree("9999-12-31"));
    FieldTypeValidator.validateValue("DATE", null, om.valueToTree("1900-01-01"));
  }
}
