package com.workplace.auth.dto;

/**
 * AGENT 의 활성 자격증명 참조(WP-1296·1297) — 원문 없이 id(=runner 쪽 Secret 버전)와 provider 만. desired 가 템플릿 계정과
 * 같은 종류인지 보고 login 버전을 정할 때 쓴다.
 *
 * @param id 활성 자격증명 행 id
 * @param provider 저장된 provider 그대로 — V119 이전 레거시는 null 일 수 있다(비교는 {@code AgentProviders.normalize}
 *     를 거친다)
 */
public record ActiveCredentialRef(long id, String provider) {}
