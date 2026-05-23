package com.workplace.label.dto;

import com.workplace.label.exception.InvalidColorTokenException;
import java.util.Set;

/** 라벨 색상 화이트리스트. 12색 사전 정의 팔레트. */
public final class ColorToken {
  private ColorToken() {}

  /** 허용 토큰 집합. */
  public static final Set<String> ALL =
      Set.of(
          "GRAY", "RED", "ORANGE", "YELLOW", "GREEN", "TEAL", "CYAN", "BLUE", "INDIGO", "PURPLE",
          "PINK", "BROWN");

  /** 허용 토큰인지 검증하고 그대로 반환. 아니면 {@link InvalidColorTokenException}. */
  public static String validate(String token) {
    if (token == null || token.isBlank() || !ALL.contains(token)) {
      throw new InvalidColorTokenException(token);
    }
    return token;
  }
}
