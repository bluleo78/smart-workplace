package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidFieldTypeException;
import java.util.Set;

/**
 * 프로젝트 custom field 의 5 가지 허용 타입 화이트리스트. SELECT / MULTI_SELECT 만 options 필요. 코드 전역에서 enum 대신 문자열 +
 * 화이트리스트 비교로 통일 — DB 컬럼이 VARCHAR(16) 이며 응답 JSON 도 raw 문자열.
 */
public final class FieldType {

  private FieldType() {}

  public static final Set<String> ALL = Set.of("TEXT", "NUMBER", "DATE", "SELECT", "MULTI_SELECT");

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
}
