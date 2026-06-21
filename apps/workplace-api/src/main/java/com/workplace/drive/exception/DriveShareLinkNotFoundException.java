package com.workplace.drive.exception;

/** 토큰에 해당하는 공유 링크가 없음(미존재/잘못된 토큰). → 404 */
public class DriveShareLinkNotFoundException extends RuntimeException {
  public DriveShareLinkNotFoundException() {
    super("share link not found");
  }
}
