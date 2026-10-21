package com.workplace.mail.dto;

import com.workplace.mail.util.MailComposeLimits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 새 메일 AI 초안 요청(WP-576, 미영속). 사용자가 "무엇을 쓸지" 지시한 한 줄/문단과 이미 채워 둔 받는사람·제목을 근거로 본문(필요하면 제목까지)을 만든다.
 *
 * @param instruction 작성 지시(필수·공백 불가). 상한 4000자 — 한 번의 지시문으로 충분하고 프롬프트 폭주를 막는다.
 * @param to 받는사람 주소(없으면 null/빈 목록 허용)
 * @param cc 참조 주소(없으면 null/빈 목록 허용)
 * @param subject 이미 쓴 제목. 비어 있을 때만 AI 가 제목을 만든다.
 *     <p>받는사람·제목 상한은 임시저장·발송과 같은 {@link MailComposeLimits} 상수다.
 */
public record MailComposeDraftRequest(
    @NotBlank @Size(max = 4000) String instruction,
    @Size(max = MailComposeLimits.MAX_RECIPIENTS)
        List<@Size(max = MailComposeLimits.MAX_ADDRESS_LENGTH) String> to,
    @Size(max = MailComposeLimits.MAX_RECIPIENTS)
        List<@Size(max = MailComposeLimits.MAX_ADDRESS_LENGTH) String> cc,
    @Size(max = MailComposeLimits.MAX_SUBJECT_LENGTH) String subject) {}
