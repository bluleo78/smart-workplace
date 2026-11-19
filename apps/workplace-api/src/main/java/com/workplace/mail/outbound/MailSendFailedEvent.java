package com.workplace.mail.outbound;

/**
 * 보낼 대기열(WP-1786)의 메일이 나가지 못했다 — 메일 도메인이 임시보관 행을 FAILED 로 돌린 바로 그 트랜잭션 안에서 발행하고, 알림(notify) 도메인이 받아
 * 보낸 본인에게 「메일을 보내지 못함」(unknown=false) 또는 「보냈는지 확인하지 못함」(unknown=true) 알림을 만든다. 메일이 notify 패키지를 직접
 * 부르지 않게(도메인 간 통신은 이벤트) 나눈 것이다.
 *
 * <p>다른 도메인 이벤트와 달리 <b>동기·같은 트랜잭션</b>({@code @EventListener})으로 소비해야 한다 — 상태 전환과 알림이 함께 커밋되거나 함께
 * 롤백돼야 「실패로 바뀌었는데 알림이 없는」(또는 그 반대) 경우가 없다. 리스너의 예외는 발행한 트랜잭션을 롤백시킨다.
 *
 * @param userId 보낸 사람(알림 받는 사람)
 * @param draftId 실패한 임시보관 id — 알림을 누르면 쓰기 창으로 연다
 * @param subject 메일 제목(비었으면 알림 쪽이 「(제목 없음)」)
 * @param unknown 발송 중 멈춰 결과를 모르면 true, 확실히 실패했으면 false
 */
public record MailSendFailedEvent(long userId, long draftId, String subject, boolean unknown) {}
