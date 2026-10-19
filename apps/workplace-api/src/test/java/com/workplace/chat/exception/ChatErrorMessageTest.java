package com.workplace.chat.exception;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * WP-564: 이슈 챗 오류 문구는 토스트·MCP 응답으로 그대로 보이므로 threadId·userId·messageId 같은 내부 값을 싣지 않는다(팀 채팅 WP-510 과
 * 같은 규칙).
 */
class ChatErrorMessageTest {

  @Test
  void userFacingMessages_haveNoInternalIds() {
    List<RuntimeException> errors =
        List.of(
            new ChatThreadNotMemberException(5L, 13L),
            new ChatMessageNotFoundException(77L),
            new ChatMessageAuthorMismatchException(77L, 13L),
            new ChatThreadIssueDeletedException(5L),
            new ChatAttachmentNotFoundException(55L));

    for (RuntimeException e : errors) {
      assertThat(e.getMessage())
          .as(e.getClass().getSimpleName())
          .doesNotContainPattern("[0-9]")
          .doesNotContain("Id:")
          .doesNotContain("id:");
    }
    // 원래 멤버였다가 프로젝트가 지워진 사람에게도 맞는 안내 — 「참여하지 않은 사용자」라고 단정하지 않는다.
    assertThat(new ChatThreadNotMemberException(5L, 13L).getMessage())
        .isEqualTo("이 대화에 접근할 권한이 없습니다");
  }
}
