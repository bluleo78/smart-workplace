package com.workplace.mail.dto;

/** 스케줄러가 테넌트 범위에서 선제 요약을 돌릴 AI 활성 계정 참조. */
public record AiAccountRef(long userId, long accountId) {}
