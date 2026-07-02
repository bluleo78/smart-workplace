package com.workplace.drive.exception;

/**
 * 이동/복사 대상이 부적절 — 다른 공간이거나, 폴더 자신·하위(서브트리)로의 이동/복사, 그 외 잘못된 대상.
 *
 * <p>메시지는 호출부에서 사용자 노출용 한국어 문자열을 직접 전달한다(#594: 영문 개발자 메시지가 토스트에 그대로 노출되던 문제 정정).
 */
public class DriveInvalidTargetException extends RuntimeException {
  public DriveInvalidTargetException(String message) {
    super(message);
  }
}
