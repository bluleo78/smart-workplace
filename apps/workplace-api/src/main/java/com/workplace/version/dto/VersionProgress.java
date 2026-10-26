package com.workplace.version.dto;

/** 버전 진행 집계 — 수정 버전(FIX)이 붙은 (삭제되지 않은) 이슈를 상태 범주로 센다. 취소는 완료로 센다(사이클 진행과 같은 기준). 전체 = 세 값의 합. */
public record VersionProgress(int done, int inProgress, int todo) {

  /** 붙은 이슈가 없는 버전의 진행. */
  public static final VersionProgress EMPTY = new VersionProgress(0, 0, 0);
}
