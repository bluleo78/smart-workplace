package com.workplace.issue.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

/** 스테이징 파일 클레임 요청(WP-422) — 먼저 올려 둔 파일의 id 목록. 한 번에 이슈당 첨부 한도(10개)까지만 받는다(누적 한도는 서비스가 다시 본다). */
public record ClaimAttachmentsRequest(@NotEmpty @Size(max = 10) List<Long> fileIds) {}
