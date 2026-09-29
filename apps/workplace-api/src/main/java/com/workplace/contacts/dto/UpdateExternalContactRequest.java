package com.workplace.contacts.dto;

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
    @Email @Size(max = 255) String email,
    @Size(max = 40) String phone,
    @Size(max = 120) String organization,
    @Size(max = 100) String title,
    String notes,
    @Pattern(regexp = "SHARED|PERSONAL") String visibility) {}
