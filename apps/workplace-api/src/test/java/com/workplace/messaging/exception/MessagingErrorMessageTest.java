package com.workplace.messaging.exception;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-510: 팀 채팅 오류 문구는 토스트로 그대로 보이므로 channelId·userId·action 같은 내부 값을 싣지 않는다. */
class MessagingErrorMessageTest {

  @Test
  void userFacingMessages_haveNoInternalIds() {
    List<RuntimeException> errors =
        List.of(
            new ChannelForbiddenException(18L, 4L, "join-private"),
            new ChannelNotMemberException(18L, 4L),
            new ChannelNotFoundException(18L),
            new MessageNotFoundException(77L),
            new MessageAuthorMismatchException(77L, 4L),
            new OwnershipTransferRequiredException(18L),
            new AgentCannotOwnChannelException(18L, 4L),
            new InvalidThreadParentException(77L),
            new ChannelArchivedException(18L),
            new InvalidMessageAttachmentException(55L));

    for (RuntimeException e : errors) {
      assertThat(e.getMessage())
          .as(e.getClass().getSimpleName())
          .doesNotContainPattern("[0-9]")
          .doesNotContain("Id:")
          .doesNotContain("action");
    }
    assertThat(new ChannelNotMemberException(18L, 4L).getMessage()).isEqualTo("채널에 참여하지 않은 사용자입니다");
  }
}
