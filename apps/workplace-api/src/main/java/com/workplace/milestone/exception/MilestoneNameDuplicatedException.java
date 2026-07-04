package com.workplace.milestone.exception;

/** 같은 프로젝트 내 마일스톤 이름 중복 — 409 매핑. */
public class MilestoneNameDuplicatedException extends RuntimeException {
  public MilestoneNameDuplicatedException(String name) {
    super("이미 존재하는 마일스톤 이름입니다: " + name);
  }
}
