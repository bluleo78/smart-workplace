package com.workplace.global.realtime;

/** 공유 슬롯 1건의 취소 판정용 요약(WP-1974) — 소유자(403 판정)와 생성이 도는 파드(로컬 핸들이 없을 때 낡은 행인지, 중계해야 하는지 가르는 기준). */
public record GenerationSlot(long ownerUserId, String podId) {}
