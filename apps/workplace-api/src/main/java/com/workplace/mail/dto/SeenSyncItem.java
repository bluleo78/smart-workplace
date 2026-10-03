package com.workplace.mail.dto;

/** WP-187 읽음 역동기화 한 통 — 처리 시점 DB 의 seen 을 서버에 맞춘다(이벤트 값 아님). */
public record SeenSyncItem(long messageId, ReadSyncLocator locator, boolean seen) {}
