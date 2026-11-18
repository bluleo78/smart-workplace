package com.workplace.mail.dto;

/**
 * 서버 휴지통 메일 수 조회(WP-1708) 응답 — {@code GET /accounts/{accountId}/trash/count}. 휴지통 비우기 확인 창이 로컬 폴더
 * 목록의 낡은 수 대신 이 값을 보여 준다.
 *
 * @param count 서버 휴지통의 실제 메일 수(앱이 가져오지 않은 옛 메일 포함)
 */
public record MailTrashCountResponse(int count) {}
