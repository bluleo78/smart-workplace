package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 관리자 「외부 공유 허용」 스위치(WP-579) — 조회·저장 응답과 저장 요청이 같은 모양이다(웹 {@code getSharePolicy}·{@code
 * saveSharePolicy}).
 *
 * @param externalShareEnabled 켜져 있으면 외부(PUBLIC) 링크를 만들 수 있다. 끄면 기존 외부 링크가 모두 지워진다. 객체 타입 +
 *     {@code @NotNull} — 값이 빠지거나 키 이름이 틀린 요청이 조용히 false 로 묶여 외부 링크를 지우지 않게 400 으로 거절한다
 */
public record WikiSharePolicy(@NotNull Boolean externalShareEnabled) {}
