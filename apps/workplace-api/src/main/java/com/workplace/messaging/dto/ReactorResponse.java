package com.workplace.messaging.dto;

/** 반응자 1명. kind = HUMAN/AGENT(웹 아바타 봇 배지용). */
public record ReactorResponse(long userId, String name, String kind) {}
