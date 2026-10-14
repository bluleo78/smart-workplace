package com.workplace.issue.dto;

/**
 * agent_work 부분 갱신 값(WP-377). null 필드는 기존 값을 유지하고, clearNote 가 true 면 note 를 NULL 로 지운다(note 의 null
 * 은 "유지"라 지우기를 별도 플래그로 구분).
 */
public record AgentWorkPatch(
    String tool,
    String state,
    String note,
    boolean clearNote,
    Integer progress,
    Integer stepsDone,
    Integer stepsTotal) {

  /** tool 만 지정값으로 덮은 사본 — 나머지 필드는 그대로. */
  public AgentWorkPatch withTool(String newTool) {
    return new AgentWorkPatch(newTool, state, note, clearNote, progress, stepsDone, stepsTotal);
  }

  /** state 만 지정값으로 덮은 사본 — 나머지 필드는 그대로. */
  public AgentWorkPatch withState(String newState) {
    return new AgentWorkPatch(tool, newState, note, clearNote, progress, stepsDone, stepsTotal);
  }

  /** note 를 비우도록(새 note 는 버리고 clearNote=true) 바꾼 사본 — 나머지 필드는 그대로. */
  public AgentWorkPatch withClearedNote() {
    return new AgentWorkPatch(tool, state, null, true, progress, stepsDone, stepsTotal);
  }

  /** 아무것도 바꾸지 않는 패치 — updated_at 갱신(터치)만 할 때 쓴다. */
  public static AgentWorkPatch empty() {
    return new AgentWorkPatch(null, null, null, false, null, null, null);
  }
}
