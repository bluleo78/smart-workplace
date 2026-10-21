package com.workplace.mail.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 임시저장 목록 한 줄(WP-577). 본문 HTML 은 싣지 않는다(목록이 최대 200건 × 2MB 를 읽지 않게). 참조·숨은참조도 목록 행에 보이지 않아 싣지 않는다.
 *
 * @param preview 본문 텍스트 앞 120자(공백 정리)
 * @param attachmentCount 묶인 업로드 + 아직 남아 있는 전달 원본 첨부 수
 */
public record MailDraftSummary(
    long id,
    long accountId,
    String mode,
    List<String> to,
    String subject,
    String preview,
    int attachmentCount,
    OffsetDateTime updatedAt) {}
