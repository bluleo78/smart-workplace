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
    assertThatThrownBy(() -> FieldTypeValidator.validateOptions("SELECT", null))
        .isInstanceOf(InvalidFieldOptionsException.class);
    assertThatThrownBy(
            () -> FieldTypeValidator.validateOptions("MULTI_SELECT", om.createArrayNode()))
        .isInstanceOf(InvalidFieldOptionsException.class);
  }

  @Test
  void options_forbidden_for_text_number_date() {
    var arr = om.createArrayNode().add("a");
    assertThatThrownBy(() -> FieldTypeValidator.validateOptions("TEXT", arr))
        .isInstanceOf(InvalidFieldOptionsException.class);
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
}
