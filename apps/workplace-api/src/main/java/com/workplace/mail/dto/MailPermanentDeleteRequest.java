package com.workplace.mail.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * WP-1682 휴지통 메일 완전히 삭제 요청. 화면은 한 통씩 보내지만 API 는 옮기기와 같은 상한까지 여러 통을 받는다.
 *
 * @param messageIds 완전히 삭제할 메일(1~{@value MailMoveRequest#MAX_MESSAGES}통, 모두 같은 계정의 휴지통 메일)
 */
public record MailPermanentDeleteRequest(
    @NotEmpty @Size(max = MailMoveRequest.MAX_MESSAGES) List<@NotNull Long> messageIds) {}
