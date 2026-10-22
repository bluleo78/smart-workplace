package com.workplace.global.validation;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.messaging.dto.UpdateMessageRequest;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

/** WP-777: 본문 수정·댓글 요청이 보이지 않는 글자만 있는 본문을 400 으로 거절하는지 검증한다. */
class VisibleTextValidationTest {

  private static final Validator VALIDATOR =
      Validation.buildDefaultValidatorFactory().getValidator();

  private static final String[] INVISIBLE_ONLY = {"​", "⠀", "​⠀ ㅤ", "­"};

  @Test
  void 보이지_않는_글자만_있으면_네_요청_모두_거절한다() {
    for (String body : INVISIBLE_ONLY) {
      assertThat(VALIDATOR.validate(new UpdateMessageRequest(body))).as("채널 수정").isNotEmpty();
      assertThat(VALIDATOR.validate(new UpdateChatMessageRequest(body))).as("챗 수정").isNotEmpty();
      assertThat(VALIDATOR.validate(new CreateCommentRequest(body))).as("댓글 작성").isNotEmpty();
      assertThat(VALIDATOR.validate(new UpdateCommentRequest(body))).as("댓글 수정").isNotEmpty();
    }
  }

  @Test
  void 글자가_하나라도_보이면_통과한다() {
    for (String body : new String[] {"안녕", "​안녕​", "👍", "줄1\n줄2"}) {
      assertThat(VALIDATOR.validate(new UpdateMessageRequest(body))).as(body).isEmpty();
      assertThat(VALIDATOR.validate(new UpdateChatMessageRequest(body))).as(body).isEmpty();
      assertThat(VALIDATOR.validate(new CreateCommentRequest(body))).as(body).isEmpty();
      assertThat(VALIDATOR.validate(new UpdateCommentRequest(body))).as(body).isEmpty();
    }
  }
}
