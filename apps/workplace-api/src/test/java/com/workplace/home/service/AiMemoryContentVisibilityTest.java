package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.home.exception.SharedAiMemoryException;
import org.junit.jupiter.api.Test;

/** WP-724: 공용·개인 AI 메모리 내용 — 그려지는 글자 없이 점자 빈칸·결합 문자만 있으면 빈 내용으로 거절한다. */
class AiMemoryContentVisibilityTest {

  @Test
  void sharedMemory_rejectsBrailleBlankOnlyContent() {
    assertThatThrownBy(() -> SharedAiMemoryService.normalizeContent("⠀⠀"))
        .isInstanceOf(SharedAiMemoryException.class)
        .hasMessage("내용은 1~300자로 적어 주세요.");
    assertThatThrownBy(() -> SharedAiMemoryService.normalizeContent("͏️"))
        .isInstanceOf(SharedAiMemoryException.class);
    assertThat(SharedAiMemoryService.normalizeContent(" 회의록은 노트에 남긴다 ")).isEqualTo("회의록은 노트에 남긴다");
  }

  @Test
  void personalMemory_rejectsBrailleBlankOnlyContent() {
    assertThatThrownBy(() -> AiMemoryService.normalizeContent("⠀⠀"))
        .hasMessage("메모리 내용은 1~300자여야 해요");
    assertThat(AiMemoryService.normalizeContent("아침 회의는 9시")).isEqualTo("아침 회의는 9시");
  }
}
