package com.workplace.global.validation;

import java.util.regex.Pattern;

/**
 * AI 모델 id 꼴 규칙 한 곳(WP-1405·1297) — 실행 템플릿의 계정 모델 칸 저장 검증과 로그인 계정 모델 목록 보고 검증이 같은 규칙을 쓰도록 둔다.
 *
 * <p>1~128자, 공백·제어 문자 없이 영문·숫자와 {@code . _ : / @ [ ] -} 만. 별칭(opus), 전체 id(claude-opus-5-5[1m]),
 * 공급자 접두(provider/model)를 모두 받고, settings.json·defaultModel 에 개행·공백 같은 이상한 값이 들어가지 않게 막는다.
 */
public final class ModelIds {

  /** Bean Validation {@code @Pattern(regexp = …)} 에 쓰는 정규식 문자열. */
  public static final String REGEX = "[A-Za-z0-9._:/@\\[\\]-]{1,128}";

  /** 같은 정규식의 컴파일본(밖에서는 {@link #isValid} 로 쓴다). */
  private static final Pattern PATTERN = Pattern.compile(REGEX);

  private ModelIds() {}

  /** 모델 id 꼴이면 true. */
  public static boolean isValid(String id) {
    return id != null && PATTERN.matcher(id).matches();
  }
}
