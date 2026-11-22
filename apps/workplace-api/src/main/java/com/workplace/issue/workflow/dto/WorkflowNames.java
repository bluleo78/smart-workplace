package com.workplace.issue.workflow.dto;

import com.workplace.global.util.SingleLineTitles;

/**
 * 만들기·PATCH 가 함께 쓰는 이름 다듬기 — 프로젝트·버전 이름과 같은 규칙({@link SingleLineTitles})이되 원문 길이를 먼저 본다.
 *
 * <p>왜: 공용 다듬기는 글자 사이의 긴 공백·제로폭에서 제곱 시간인데, DTO 생성자라 길이·프로젝트 권한 검사보다 먼저 돈다. 긴 원문 하나가 CPU 를 오래 잡지 못하게
 * 여기서 막는다.
 */
final class WorkflowNames {

  /** 다듬어 볼 원문 상한(UTF-16) — 이름 상한 100자보다 넉넉하면서 다듬기가 수 ms 에 끝나는 크기. */
  private static final int MAX_RAW_LENGTH = 1_000;

  private WorkflowNames() {}

  /** 상한 안이면 다듬은 이름, 넘으면 원문 그대로(이름 칸의 {@code @Size(max = 100)} 이 400 으로 거절한다). null 은 그대로. */
  static String normalize(String raw) {
    if (raw != null && raw.length() > MAX_RAW_LENGTH) return raw;
    return SingleLineTitles.normalize(raw);
  }
}
