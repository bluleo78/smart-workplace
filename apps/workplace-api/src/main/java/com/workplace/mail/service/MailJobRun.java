package com.workplace.mail.service;

import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import java.util.UUID;

/**
 * 이 파드가 선점한 메일 작업 실행 한 건의 핸들(WP-1977) — 작업 종류·계정·실행 토큰(run_id)·선점 당시 테넌트를 담는다.
 *
 * <p>진행 쓰기·끝내기·되돌리기는 계정 id 가 아니라 이 핸들로 한다. 같은 파드에서 옛 실행이 만료돼 같은 계정을 다시 선점해도, 옛 실행은 자기 핸들(옛 토큰)만 들고
 * 있어 새 실행의 행을 건드리지 못한다(계정 id 로 메모리에서 토큰을 찾던 방식은 재선점이 항목을 덮어써 옛 실행이 새 토큰으로 쓸 수 있었다). 테넌트를 함께 들고 있어
 * 테넌트 문맥이 없는 스레드(백필 워커·하트비트 스레드)에서도 RLS 문맥을 세워 쓸 수 있다.
 *
 * @param kind 작업 종류(SYNC·TRASH_EMPTY)
 * @param accountId 메일 계정 id
 * @param runId 선점 때 발급한 실행 토큰 — 이후 쓰기는 이 토큰이 행과 일치할 때만 적용된다
 * @param tenantId 선점 당시 테넌트(문맥이 없었으면 null — 그때는 호출자 문맥에 맡긴다)
 */
public record MailJobRun(Kind kind, long accountId, UUID runId, Long tenantId) {}
