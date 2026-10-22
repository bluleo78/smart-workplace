package com.workplace.global.validation;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.InviteAttendeesRequest;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.messaging.dto.CreateMessageRequest;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-794: id 목록 개수 상한 — 같은 id 를 수만 번 넣은 요청은 400, 상한 안의 중복은 한 번만 처리한다. */
class ListSizeCapValidationTest {

  private static final Validator VALIDATOR =
      Validation.buildDefaultValidatorFactory().getValidator();

  private static List<Long> repeated(int n) {
    return Collections.nCopies(n, 7L);
  }

  @Test
  void driveFileIds_overCap_rejected() {
    assertThat(VALIDATOR.validate(new CreateMessageRequest("x", null, List.of(), repeated(20_000))))
        .isNotEmpty();
    assertThat(VALIDATOR.validate(new CreateChatMessageRequest("x", List.of(), repeated(20_000))))
        .isNotEmpty();
    assertThat(VALIDATOR.validate(new CreateMessageRequest("x", null, List.of(), repeated(50))))
        .isEmpty();
  }

  @Test
  void driveFileIds_duplicatesCollapsed() {
    assertThat(new CreateMessageRequest("x", null, List.of(), List.of(7L, 7L, 8L)).driveFileIds())
        .containsExactly(7L, 8L);
    assertThat(new CreateChatMessageRequest("x", List.of(), List.of(7L, 7L)).driveFileIds())
        .containsExactly(7L);
  }

  @Test
  void attendees_overCap_rejected() {
    assertThat(VALIDATOR.validate(new InviteAttendeesRequest(repeated(20_000)))).isNotEmpty();
    assertThat(VALIDATOR.validate(new InviteAttendeesRequest(repeated(500)))).isEmpty();
  }
}
