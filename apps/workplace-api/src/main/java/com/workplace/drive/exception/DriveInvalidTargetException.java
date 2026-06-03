package com.workplace.drive.exception;

/** 이동/복사 대상이 부적절 — 다른 공간이거나, 폴더 자신·하위(서브트리)로의 이동/복사. */
public class DriveInvalidTargetException extends RuntimeException {
  public DriveInvalidTargetException(String reason) {
    super("invalid move/copy target: " + reason);
  }
}
