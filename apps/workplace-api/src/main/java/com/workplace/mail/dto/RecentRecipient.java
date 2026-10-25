package com.workplace.mail.dto;

import java.time.OffsetDateTime;

/**
 * 작성창 받는사람 자동완성의 최근 수신인 후보(WP-945) — 내가 보낸 메일의 받는사람·참조·숨은참조에서 모은 한 사람.
 *
 * @param address 소문자 주소
 * @param name 보낼 때 함께 적은 표시 이름(가장 최근 것, 없으면 null)
 * @param lastSentAt 마지막으로 보낸 시각
 * @param sentCount 살펴본 최근 보낸 메일 가운데 이 주소가 들어 있던 통 수
 */
public record RecentRecipient(
    String address, String name, OffsetDateTime lastSentAt, int sentCount) {}
