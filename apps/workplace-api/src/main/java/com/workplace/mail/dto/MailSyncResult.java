package com.workplace.mail.dto;

/** 수동/스케줄 동기화 1회 결과 요약. */
public record MailSyncResult(int fetched, int saved) {}
