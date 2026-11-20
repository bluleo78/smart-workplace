package com.workplace.mail.dto;

import java.time.OffsetDateTime;

/**
 * 계정별 임시저장 개수(WP-577, 사이드바 배지).
 *
 * @param count 임시보관함에 보이는 행 수(일반·보내기 실패) — 보내기 대기 행은 세지 않는다
 * @param queued 보내기 대기 행 수(WP-1786, send_at 있음) — 계정 삭제 확인창이 「보내기 대기 n건도 함께 삭제됩니다」에 쓴다
 * @param scheduled 예약 보내기 대기 행 수(WP-1787, 대기 중이며 예약으로 올린 것) — 사이드바 「예약됨」 배지
 * @param nextSendAt 가장 이른 예약 시각(WP-1787 코드 리뷰, 예약이 없으면 null) — 웹이 이 시각 근처에서만 배지를 다시 받게 한다(늘 30초마다
 *     받지 않게)
 */
public record MailDraftCount(long count, long queued, long scheduled, OffsetDateTime nextSendAt) {}
