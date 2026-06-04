package com.workplace.mail.dto;

/** 답장 헤더/스레드 구성용 부모 메시지 컨텍스트. parentMessageId/threadId 는 꺾쇠 없는 정규화 id. */
public record ReplyContext(String threadId, String parentMessageId, String parentReferences) {}
