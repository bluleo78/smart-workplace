package com.workplace.drive.exception;

/** 공유 링크가 만료되었거나 폐기됨. → 410 Gone */
public class DriveShareLinkGoneException extends RuntimeException {
  public DriveShareLinkGoneException() {
    super("share link expired or revoked");
  }
}
