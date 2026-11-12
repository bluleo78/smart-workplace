package com.workplace.drive.exception;

/**
 * 영상·오디오가 아닌 파일의 재생 주소를 요청했을 때(WP-1532). → 409. 재생 주소는 인증 없이 열리는 inline 주소라 HTML·SVG 같은 문서에 내주면 공개
 * 경로로 문서를 띄우는 길이 생기므로 미디어만 받는다.
 */
public class DriveNotPlayableException extends RuntimeException {
  public DriveNotPlayableException() {
    super("영상·오디오 파일만 바로 재생할 수 있습니다");
  }
}
