package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

/**
 * 요청자의 「HTML 문서」 임시 저장본(WP-1308) — 편집이 저장·취소 없이 끝났을 때(10분 무입력·창 닫힘·강제 풀기) 고치던 소스가 남는다. 다음 「편집」 때 이어
 * 고칠지 묻는다.
 *
 * @param html 고치던 소스
 * @param baseVersion 고치기 시작한 판
 * @param updatedAt 마지막으로 남긴 시각
 * @param pageChangedSince 그사이 다른 저장으로 판이 바뀌었는지(baseVersion ≠ 지금 version) — 이어 고치기 전에 알린다
 */
public record WikiHtmlDraftInfo(
    String html, int baseVersion, OffsetDateTime updatedAt, boolean pageChangedSince) {}
