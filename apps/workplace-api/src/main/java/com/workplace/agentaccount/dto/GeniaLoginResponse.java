package com.workplace.agentaccount.dto;

import java.time.Instant;

/**
 * Gen:iA 브라우저 로그인 진행 상태 응답(WP-1461). code_verifier·state·access token 은 싣지 않는다.
 *
 * @param id 진행 id — 상태 조회·취소에 쓴다
 * @param status PENDING(승인 대기)·SUCCEEDED(계정 저장됨)·EXPIRED(시간 지남)·FAILED(실패)
 * @param authorizeUrl 사용자가 새 탭에서 열 로그인 주소 — 대기 중에만 싣는다
 * @param expiresAt 로그인 요청 만료 시각
 * @param accountId 성공 때 저장된 계정 id(다시 로그인이면 대상 계정 id)
 * @param accountEmail 성공 때 로그인한 계정 이메일
 * @param errorMessage 실패 사유(사용자에게 그대로 보일 문구)
 */
public record GeniaLoginResponse(
    String id,
    String status,
    String authorizeUrl,
    Instant expiresAt,
    Long accountId,
    String accountEmail,
    String errorMessage) {}
