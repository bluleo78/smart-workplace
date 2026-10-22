package com.workplace.contacts.dto;

import com.workplace.global.util.AccountIdentifierRules;
import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 외부 연락처 부분 수정 요청(#839). 필드 생략(null)=현재 값 유지, 빈 문자열=값 비우기(optional 필드만 — 서비스가 null 로 정규화).
 *
 * <p>이전에는 {@link ExternalContactRequest} 로 전체 교체만 가능해, AI 도구가 전화번호 하나만 고치려 해도 모든 필드를 다시 보내야 했고 빠뜨린
 * 필드는 조용히 지워졌다. 웹 폼은 모든 필드를(비운 칸은 "") 보내므로 이 의미론으로 동작이 바뀌지 않는다.
 *
 * <p>name 은 비울 수 없다 — {@code @Pattern} 은 null 을 통과시키므로 "생략=유지, 공백=400" 이 된다.
 */
public record UpdateExternalContactRequest(
    @Pattern(regexp = "(?s).*\\S.*", message = "이름은 비울 수 없습니다") @Size(max = 120) String name,
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
    @Pattern(regexp = "SHARED|PERSONAL") String visibility) {
  public UpdateExternalContactRequest {
    // 이름은 한 줄로 다듬는다 — 앞뒤 공백·제로폭 문자만 남은 이름이 목록에 빈 줄로 보였다(WP-628). 다듬어 비면 아래 검증이 한국어로 거절한다
    name = SingleLineTitles.normalize(name);
    // 전화·소속·직함도 한 줄로 다듬는다(WP-791) — 보이지 않는 글자만 남으면 빈 값(저장 시 null)이 되고 줄바꿈은 공백 하나가 된다. 다듬지 않으면
    // 조직 필터 목록에 보이지 않는 빈 항목·두 줄 항목이 생겼다. 메모는 여러 줄이 의도라 그대로 둔다
    phone = SingleLineTitles.normalize(phone);
    organization = SingleLineTitles.normalize(organization);
    title = SingleLineTitles.normalize(title);
  }
}
