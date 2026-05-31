package com.workplace.auth.exception;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

class HomeAssistantNotConfiguredExceptionTest {
  @Test
  void 메시지보존_그리고_503_매핑() {
    var ex = new HomeAssistantNotConfiguredException("미설정");
    assertThat(ex.getMessage()).isEqualTo("미설정");
    var rs =
        AnnotationUtils.findAnnotation(
            HomeAssistantNotConfiguredException.class, ResponseStatus.class);
    assertThat(rs).isNotNull();
    assertThat(rs.value()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
  }
}
