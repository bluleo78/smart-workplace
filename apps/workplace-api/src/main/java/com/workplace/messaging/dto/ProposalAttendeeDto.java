package com.workplace.messaging.dto;

/**
 * 일정 제안 카드에 보여줄 초대 참석자 1명(#852). 제안 시점에 서버가 user id 를 이름으로 해석해 payload 에 담아 둔다 — 카드는 승인 전에 "누구를
 * 초대하는지"를 사람이 확인하는 자리라 id 만으로는 부족하다.
 */
public record ProposalAttendeeDto(long userId, String name) {}
