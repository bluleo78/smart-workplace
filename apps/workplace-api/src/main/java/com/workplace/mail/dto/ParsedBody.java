package com.workplace.mail.dto;

import java.util.List;

/** 본문 전용 파싱 결과(OnDemand/백그라운드 본문 적재용). */
public record ParsedBody(
    String bodyText,
    String bodyHtml,
    String snippet,
    boolean hasAttachment,
    List<ParsedAttachment> attachments) {}
