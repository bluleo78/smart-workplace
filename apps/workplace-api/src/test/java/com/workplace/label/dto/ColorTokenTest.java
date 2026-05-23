package com.workplace.label.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.label.exception.InvalidColorTokenException;
import org.junit.jupiter.api.Test;

/** ColorToken 화이트리스트 검증 단위 테스트. */
class ColorTokenTest {

  @Test
  void valid_tokens_accepted() {
    for (String t :
        new String[] {
          "GRAY", "RED", "ORANGE", "YELLOW", "GREEN", "TEAL", "CYAN", "BLUE", "INDIGO", "PURPLE",
          "PINK", "BROWN"
        }) {
      assertThat(ColorToken.validate(t)).isEqualTo(t);
    }
  }

  @Test
  void unknown_token_throws() {
    assertThatThrownBy(() -> ColorToken.validate("MAGENTA"))
        .isInstanceOf(InvalidColorTokenException.class);
  }

  @Test
  void null_or_blank_throws() {
    assertThatThrownBy(() -> ColorToken.validate(null))
        .isInstanceOf(InvalidColorTokenException.class);
    assertThatThrownBy(() -> ColorToken.validate(""))
        .isInstanceOf(InvalidColorTokenException.class);
  }
}
