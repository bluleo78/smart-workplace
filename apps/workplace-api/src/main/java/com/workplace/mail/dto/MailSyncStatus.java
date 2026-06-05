package com.workplace.mail.dto;

/** 수동 동기화 진행 상태. phase: LIST(목록) → BODIES(본문 보충) → IDLE(완료/없음). */
public record MailSyncStatus(String phase, int total, int done, boolean running) {}
