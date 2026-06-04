package com.workplace.mail.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 메일 계정 생성/수정/연결테스트 요청. password 는 생성·테스트 시 필수이나, 수정 시 빈 값이면 "기존 비밀번호 유지" 를 뜻하므로 bean validation 으로
 * 강제하지 않고 서비스에서 처리한다.
 *
 * @param password 평문 비밀번호(앱 비밀번호). 응답에는 절대 포함되지 않는다.
 */
public record EmailAccountRequest(
    @NotBlank @Email String emailAddress,
    String displayName,
    @NotBlank String imapHost,
    @Min(1) @Max(65535) int imapPort,
    @NotNull MailSecurity imapSecurity,
    @NotBlank String imapUsername,
    @NotBlank String smtpHost,
    @Min(1) @Max(65535) int smtpPort,
    @NotNull MailSecurity smtpSecurity,
    @NotBlank String smtpUsername,
    String password,
    boolean aiEnabled) {} // aiEnabled: AI 비서 활성화 여부(기본 false)
