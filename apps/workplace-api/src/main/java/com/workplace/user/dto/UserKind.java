package com.workplace.user.dto;

import java.util.Set;

/** 유저 종류 화이트리스트. HUMAN=일반 사용자, AGENT=AI 에이전트(로그인 불가, API 키로 인증). */
public final class UserKind {

  private UserKind() {}

  public static final String HUMAN = "HUMAN";
  public static final String AGENT = "AGENT";
  public static final Set<String> ALL = Set.of(HUMAN, AGENT);

  /** 주어진 kind 가 AGENT 인지 확인. null-safe. */
  public static boolean isAgent(String kind) {
    return AGENT.equals(kind);
  }
}
