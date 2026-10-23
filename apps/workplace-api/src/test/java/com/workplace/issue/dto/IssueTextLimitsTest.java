package com.workplace.issue.dto;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.PromoteToIssueRequest;
import com.workplace.messaging.dto.CreateProposalRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * WP-885 — 이슈 본문·코멘트 상한(5만자)을 공유하는 요청 중 컨트롤러 테스트가 닿지 않는 메일 승격·채팅 제안의 경계만 검증한다. 이슈 생성·수정, 코멘트 생성·수정
 * 경계는 IssueControllerTest / IssueCommentControllerTest 가 맡는다. 검증 애너테이션만 빠르게 확인(DB 불필요).
 */
class IssueTextLimitsTest {

  private static final int MAX = 50_000;

  private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

  @Test
  void 메일_승격_본문은_5만자까지_허용하고_넘으면_body_오류() {
    assertThat(bodyViolations(promote("가".repeat(MAX)))).isEmpty();
    assertThat(bodyViolations(promote("가".repeat(MAX + 1)))).isNotEmpty();
  }

  @Test
  void 채팅_이슈_제안_본문은_5만자까지_허용하고_넘으면_body_오류() {
    assertThat(bodyViolations(proposal("가".repeat(MAX)))).isEmpty();
    assertThat(bodyViolations(proposal("가".repeat(MAX + 1)))).isNotEmpty();
  }

  /** body 필드 위반만 모은다 — 다른 필드 위반이 섞여 경계 판정이 흐려지지 않게. */
  private <T> Set<ConstraintViolation<T>> bodyViolations(T request) {
    return Set.copyOf(
        validator.validate(request).stream()
            .filter(v -> v.getPropertyPath().toString().equals("body"))
            .toList());
  }

  private static PromoteToIssueRequest promote(String body) {
    return new PromoteToIssueRequest("WP", "제목", body, "MID", List.of());
  }

  private static CreateProposalRequest proposal(String body) {
    return new CreateProposalRequest(
        "CREATE_ISSUE",
        "제목",
        body,
        null,
        null,
        1L,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null);
  }
}
