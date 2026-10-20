package com.workplace.user.exception;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.exception.HomeSessionNotFoundException;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * WP-571: 구성원·홈 AI 대화 세션의 NotFound 문구는 토스트·확인카드 실패 사유·MCP 응답으로 그대로 보이므로 요청한 id 를 되돌려 싣지 않는다(이슈 챗
 * WP-564·팀 채팅 WP-510 과 같은 규칙).
 */
class UserFacingErrorMessageTest {

  @Test
  void notFoundMessages_haveNoInternalIds() {
    assertThat(UserNotFoundException.ofId(42L).getMessage()).isEqualTo("사용자를 찾을 수 없습니다");
    assertThat(new HomeSessionNotFoundException(UUID.randomUUID()).getMessage())
        .isEqualTo("대화 세션을 찾을 수 없습니다");
  }
}
