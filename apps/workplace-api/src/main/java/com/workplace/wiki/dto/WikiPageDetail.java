package com.workplace.wiki.dto;

import java.time.OffsetDateTime;

public record WikiPageDetail(
    long id,
    long spaceId,
    Long parentId,
    String title,
    String body,
    int version,
    Long updatedBy,
    OffsetDateTime updatedAt,
    // #736: 페이지 단위 AI 생성 attribution — 마지막 AI 스트림 사용 시각/액션. 둘 다 null 이면 AI 이력 없음.
    OffsetDateTime aiLastUsedAt,
    String aiLastAction,
    // WP-579: 이 페이지 자신이 링크로 공유 중인지 — 헤더 「공유 중」 표시. 설정 내용은 공유 창을 열 때 따로 받는다.
    // 만료된 공유는 링크가 열리지 않으므로 false 이고 대신 shareExpired 가 true 다(WP-1086).
    boolean shared,
    // WP-1086: 공유 설정은 남아 있지만 만료돼 링크가 열리지 않는지 — 헤더 「공유 만료」 표시.
    boolean shareExpired,
    // WP-793: 「전체 폭」 — 본문을 읽기 폭(768px) 대신 화면 폭 전체로 보이게 하는 페이지 단위 보기 설정. 그 페이지를 여는 모든 사람에게 같다.
    boolean fullWidth) {}
