package com.workplace.mail.dto;

import com.fasterxml.jackson.annotation.JsonUnwrapped;

/**
 * 내 메일 계정 목록의 한 행(WP-1674) — 계정 응답 필드를 그대로 펼치고 AI 분류 활성 여부 하나만 더한다.
 *
 * <p>메일함 화면은 계정 목록을 먼저 받은 뒤에 열린다. 분류 상태를 여기서 함께 주면 화면이 첫 목록 요청부터 맞는 보기(분류가 꺼진 계정은 전체 받은편지함)로 부른다 —
 * 안 읽은 수 응답을 기다리지 않고, 쓰지 않을 업무 목록을 먼저 받지도 않는다. 판정은 안 읽은 수의 classificationActive 와 같은
 * 규칙(MailClassifierProbe)이다. 계정 응답은 생성 지점이 많아 필드를 늘리지 않고 이 목록에서만 감싼다.
 */
public record EmailAccountListItem(
    @JsonUnwrapped EmailAccountResponse account, boolean classificationActive) {}
