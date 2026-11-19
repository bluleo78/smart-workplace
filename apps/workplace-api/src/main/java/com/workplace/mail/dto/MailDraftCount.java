package com.workplace.mail.dto;

/**
 * 계정별 임시저장 개수(WP-577, 사이드바 배지).
 *
 * @param count 임시보관함에 보이는 행 수(일반·보내기 실패) — 보내기 대기 행은 세지 않는다
 * @param queued 보내기 대기 행 수(WP-1786, send_at 있음) — 계정 삭제 확인창이 「보내기 대기 n건도 함께 삭제됩니다」에 쓴다
 */
public record MailDraftCount(long count, long queued) {}
