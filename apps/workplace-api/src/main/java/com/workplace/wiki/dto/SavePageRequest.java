package com.workplace.wiki.dto;

import jakarta.validation.constraints.Size;

/**
 * 노트 저장 요청.
 *
 * @param title null 이면 제목 유지. 제목은 버전 검사 없이 나중 값 우선(WP-290)
 * @param body null 이면 본문 유지
 * @param version 본문을 낙관적으로 저장할 때의 기준 version. 동시 편집 도입(WP-290) 후 제목만 바꾸는 요청에는 필요 없어 nullable — 동기화
 *     서버가 꺼진 기존 저장 경로에서 본문을 보낼 때만 서비스가 필수로 검사한다
 * @param snapshot 직전 상태를 리비전으로 남길지(기존 저장 경로 전용)
 */
public record SavePageRequest(
    @Size(max = 255) String title, String body, Integer version, boolean snapshot) {}
