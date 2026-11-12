package com.workplace.agentaccount.dto;

import jakarta.validation.constraints.Size;

/**
 * Gen:iA 브라우저 로그인 시작 요청(WP-1461).
 *
 * @param label 성공 때 새로 만들 계정의 라벨 — 비우면 「Gen:iA 로그인 계정」. 다시 로그인(accountId 있음)에서는 쓰지 않는다
 * @param accountId 다시 로그인할 기존 Gen:iA 계정 id — 비우면 성공 때 새 계정을 등록한다
 */
public record GeniaLoginStartRequest(@Size(max = 80) String label, Long accountId) {}
