package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidFieldTypeException;
import java.util.Map;
import java.util.Set;

/**
 * 프로젝트 custom field 의 5 가지 허용 타입 화이트리스트. SELECT / MULTI_SELECT 만 options 필요. 코드 전역에서 enum 대신 문자열 +
 * 화이트리스트 비교로 통일 — DB 컬럼이 VARCHAR(16) 이며 응답 JSON 도 raw 문자열.
 */
public final class FieldType {

  private FieldType() {}

  public static final Set<String> ALL = Set.of("TEXT", "NUMBER", "DATE", "SELECT", "MULTI_SELECT");

  // 영문 enum → 한국어 레이블 매핑 (에러 메시지 등 사용자 노출용).
  // 프론트 CustomFieldManagement.tsx 의 FIELD_TYPE_LABEL 과 동일하게 유지한다 (#805).
  private static final Map<String, String> LABEL =
      Map.of(
          "TEXT", "텍스트",
          "NUMBER", "숫자",
          "DATE", "날짜",
          "SELECT", "선택",
          "MULTI_SELECT", "복수 선택");

  /** 허용된 타입인지 검증. 통과 시 인자 그대로 반환. */
  public static String validate(String type) {
    if (type == null || !ALL.contains(type)) {
      throw new InvalidFieldTypeException(type);
    }
    return type;
  }

  /** options 가 필수인 타입인지 (SELECT / MULTI_SELECT). */
  public static boolean hasOptions(String type) {
    return "SELECT".equals(type) || "MULTI_SELECT".equals(type);
  }

  /** 사용자 노출 메시지용 한국어 레이블. 알 수 없는 타입이면 원본 문자열 그대로 반환(방어적). */
  public static String label(String type) {
    return LABEL.getOrDefault(type, type);
  }
}
