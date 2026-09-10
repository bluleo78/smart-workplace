package com.workplace.messaging.exception;

/** 같은 테넌트 내 활성(비아카이브) 채널 이름 중복 — 409 매핑(#688, 컨테이너류 이름 하드 차단 정책). */
public class ChannelNameDuplicatedException extends RuntimeException {
  public ChannelNameDuplicatedException(String name) {
    super("이미 존재하는 채널 이름입니다: " + name);
  }
}
