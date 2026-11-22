package com.workplace.issue.workflow.domain;

import java.util.regex.Pattern;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.nodes.ScalarNode;

/**
 * YAML 스칼라를 「적힌 글」 기준으로 분류·변환한다.
 *
 * <p>왜: YAML 은 yes/no/2026/null 같은 글을 암묵적으로 불리언·수·null 로 바꾸지만, 이 정의에서는 키와 문자열 칸이 적힌 글 그대로여야
 * 한다(outcome 키 yes, 이름 2026). 그래서 SnakeYAML 의 암묵 타입 해석은 끄고(파서가 모든 스칼라를 글로 만든다), 타입이 필요한
 * 칸(maxVisits·output required·좌표· equals)만 여기서 따옴표 없는 글을 직접 판정한다. 따옴표·블록 스칼라는 항상 글이다.
 */
final class YamlScalars {

  /** 스칼라 분류. */
  enum Kind {
    NULL,
    BOOL,
    INT,
    /** long 범위를 넘는 정수(수 칸에서는 거절한다 — 반올림하면 다른 값이 된다). */
    BIGINT,
    FLOAT,
    STRING
  }

  private static final Pattern INT = Pattern.compile("[-+]?[0-9]++");

  /** 정수가 아닌 수: 소수점 또는 지수가 있는 꼴. */
  private static final Pattern FLOAT =
      Pattern.compile("[-+]?(?:[0-9]++\\.[0-9]*+|\\.[0-9]++|[0-9]++)(?:[eE][-+]?[0-9]++)?");

  private YamlScalars() {}

  /** 스칼라의 분류. 따옴표·블록 스칼라는 STRING. */
  static Kind kind(ScalarNode n) {
    String v = n.getValue();
    if (n.getScalarStyle() != DumperOptions.ScalarStyle.PLAIN) {
      return Kind.STRING;
    }
    if (v.isEmpty() || v.equals("~") || v.equals("null") || v.equals("Null") || v.equals("NULL")) {
      return Kind.NULL;
    }
    if (v.equals("true") || v.equals("false")) {
      return Kind.BOOL;
    }
    if (INT.matcher(v).matches()) {
      return fitsLong(v) ? Kind.INT : Kind.BIGINT;
    }
    if (FLOAT.matcher(v).matches()) {
      return isFinite(v) ? Kind.FLOAT : Kind.STRING;
    }
    return Kind.STRING;
  }

  /** 수 종류의 스칼라 값(INT·FLOAT 에만 의미). */
  static double number(ScalarNode n) {
    return Double.parseDouble(n.getValue());
  }

  /** 타입이 있는 값: 불리언은 Boolean, 정수는 Long(범위 밖이면 Double), 소수는 Double, 그 밖은 적힌 글. */
  static Object typedValue(ScalarNode n) {
    String v = n.getValue();
    return switch (kind(n)) {
      case BOOL -> Boolean.valueOf(v);
      case INT -> Long.valueOf(v);
      case FLOAT -> Double.valueOf(v);
      default -> v;
    };
  }

  /** 정수 글이 long 범위 안인지(범위 밖이면 예외가 나는 시점에 바로 멈춘다). */
  private static boolean fitsLong(String v) {
    try {
      Long.parseLong(v);
      return true;
    } catch (NumberFormatException e) {
      return false;
    }
  }

  /** 아주 긴 자릿수가 무한대로 넘치지 않는지(넘치면 수로 보지 않고 글로 둔다). */
  private static boolean isFinite(String v) {
    return Double.isFinite(Double.parseDouble(v));
  }
}
