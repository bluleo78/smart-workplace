package com.workplace.milestone.exception;

/** 마일스톤이 존재하지 않거나 다른 프로젝트 소속임 — 404 매핑. */
public class MilestoneNotFoundException extends RuntimeException {
  public MilestoneNotFoundException(Long id) {
    super("마일스톤을 찾을 수 없습니다: id=" + id);
  }
}
