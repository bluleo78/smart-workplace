package com.workplace.issue.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.exception.InvalidFieldOptionsException;
import com.workplace.issue.exception.InvalidFieldValueException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.Set;

/**
 * type / options / value 검증 dispatcher. 모든 검증 실패는 400 으로 매핑되는 InvalidField* 예외 throw. value 가 null
 * 인 경우는 호출자가 row 삭제로 처리 — Validator 단에서는 명시적으로 거부한다.
 */
public final class FieldTypeValidator {

  private FieldTypeValidator() {}

  private static final int TEXT_MAX = 2000;
  private static final int OPTION_MAX = 40;

  /** options 검증 — SELECT/MULTI_SELECT 는 필수 (≥1, 각 1..40, UNIQUE), 그 외는 NULL/null-node 이어야 함. */
  public static void validateOptions(String type, JsonNode options) {
    if (FieldType.hasOptions(type)) {
      if (options == null || !options.isArray() || options.size() == 0) {
        throw new InvalidFieldOptionsException(type + " 는 options 가 필요합니다");
      }
      Set<String> seen = new HashSet<>();
      for (JsonNode opt : options) {
        if (!opt.isTextual()) {
          throw new InvalidFieldOptionsException("옵션은 문자열이어야 합니다");
        }
        String s = opt.asText();
        if (s.isEmpty() || s.length() > OPTION_MAX) {
          throw new InvalidFieldOptionsException("옵션 길이 1..40");
        }
        if (!seen.add(s)) {
          throw new InvalidFieldOptionsException("중복 옵션: " + s);
        }
      }
    } else if (options != null && !options.isNull()) {
      throw new InvalidFieldOptionsException(type + " 는 options 를 지정할 수 없습니다");
    }
  }

  /** value 검증 — type 별 모양 + (SELECT/MULTI_SELECT 의 경우) options 화이트리스트. */
  public static void validateValue(String type, JsonNode options, JsonNode value) {
    if (value == null || value.isNull()) {
      throw new InvalidFieldValueException("value 가 null 이면 호출자가 row 삭제로 처리");
    }
    switch (type) {
      case "TEXT" -> {
        if (!value.isTextual()) {
          throw new InvalidFieldValueException("TEXT 는 문자열");
        }
        if (value.asText().length() > TEXT_MAX) {
          throw new InvalidFieldValueException("TEXT ≤2000");
        }
      }
      case "NUMBER" -> {
        if (!value.isNumber()) {
          throw new InvalidFieldValueException("NUMBER 는 숫자");
        }
      }
      case "DATE" -> {
        if (!value.isTextual()) {
          throw new InvalidFieldValueException("DATE 는 ISO 문자열");
        }
        try {
          LocalDate.parse(value.asText());
        } catch (DateTimeParseException e) {
          throw new InvalidFieldValueException("DATE 형식 (YYYY-MM-DD)");
        }
      }
      case "SELECT" -> {
        if (!value.isTextual()) {
          throw new InvalidFieldValueException("SELECT 는 문자열");
        }
        if (!optionsContains(options, value.asText())) {
          throw new InvalidFieldValueException("옵션 외 값: " + value.asText());
        }
      }
      case "MULTI_SELECT" -> {
        if (!value.isArray()) {
          throw new InvalidFieldValueException("MULTI_SELECT 는 배열");
        }
        for (JsonNode v : value) {
          if (!v.isTextual()) {
            throw new InvalidFieldValueException("MULTI_SELECT 요소는 문자열");
          }
          if (!optionsContains(options, v.asText())) {
            throw new InvalidFieldValueException("옵션 외 값: " + v.asText());
          }
        }
      }
      default -> throw new InvalidFieldValueException("알 수 없는 타입: " + type);
    }
  }

  /** options 배열에 해당 텍스트가 존재하는지. */
  private static boolean optionsContains(JsonNode options, String v) {
    if (options == null || !options.isArray()) return false;
    for (JsonNode o : options) {
      if (o.isTextual() && o.asText().equals(v)) return true;
    }
    return false;
  }
}
