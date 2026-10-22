package com.workplace.contacts.dto;

import com.workplace.global.util.AccountIdentifierRules;
import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 외부 연락처 생성 요청(및 부분 수정 병합 결과). optional 필드의 빈 문자열은 저장 시 null 로 정규화한다. PATCH 요청 본문은 {@link
 * UpdateExternalContactRequest}(부분 수정, #839).
 */
public record ExternalContactRequest(
    @NotBlank(message = "이름을 입력해 주세요") @Size(max = 120) String name,
    // 보이지 않는 글자·다른 문자 체계 글자가 낀 이메일은 거절한다(WP-779) — @Email 은 이를 통과시켜 눈에 같은 주소가 따로 쌓이고 메일도 못 보냈다.
    // 계정 이메일과 같은 규칙(AccountIdentifierRules, WP-780). 빈 문자열(값 비우기)은 허용한다.
    @Email
        @Size(max = 255)
        @Pattern(
            regexp = AccountIdentifierRules.ASCII_ONLY,
            message = AccountIdentifierRules.EMAIL_ASCII_ONLY_MESSAGE)
        String email,
    @Size(max = 40) String phone,
    @Size(max = 120) String organization,
    @Size(max = 100) String title,
    // 메모 상한(WP-546) — 없으면 수 MB 메모가 저장돼 상세 화면이 멈췄다. 웹 폼·MCP 도구와 같은 2000자.
    @Size(max = 2000, message = "메모는 2000자 이하여야 합니다") String notes,
    @NotNull @Pattern(regexp = "SHARED|PERSONAL") String visibility) {
  public ExternalContactRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
  }
}
