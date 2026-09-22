package com.workplace.messaging.exception;

import java.util.List;

/** 위임 프로젝트(AI 제안 키 또는 승인 override)가 위임 후보 밖 — 400. */
public class InvalidDelegationProjectException extends RuntimeException {

  public InvalidDelegationProjectException(String key) {
    super("위임 후보 프로젝트가 아닙니다: " + key);
  }

  /**
   * #840: 유효 후보 키를 메시지에 함께 싣는다. AI 제안 경로에서 이 메시지가 도구 오류로 LLM 에 그대로 전달되므로, 후보 목록이 있으면 모델이 한 번의 재시도로
   * 올바른 키를 고를 수 있다.
   */
  public InvalidDelegationProjectException(String key, List<String> candidateKeys) {
    super("위임 후보 프로젝트가 아닙니다: " + key + " (후보: " + String.join(", ", candidateKeys) + ")");
  }
}
