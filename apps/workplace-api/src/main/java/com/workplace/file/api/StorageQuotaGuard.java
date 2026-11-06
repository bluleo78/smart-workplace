package com.workplace.file.api;

/**
 * 새 바이트를 저장하기 직전에 테넌트 저장 공간 한도를 묻는 훅(WP-1391).
 *
 * <p>왜 필요한가: 사용량은 내부 카테고리를 뺀 file 행 전체라, 스테이징 업로드({@code StagedUploadService})가 만드는 임시 file 행도 한도에
 * 들어간다. 그런데 한도·잠금은 drive 가 갖고 있고, {@code file} 코어가 {@code drive} 를 직접 import 하면 의존 방향이 코어 → 도메인으로
 * 뒤집힌다. 그래서 {@link ExpiredFileRetentionPolicy} 처럼 코어가 인터페이스만 두고 drive 의 {@code DriveQuotaService} 가
 * 구현한다.
 */
public interface StorageQuotaGuard {

  /**
   * 테넌트 쿼터 잠금을 잡고 {@code incomingBytes} 를 더해도 한도 안인지 본다. 넘으면 런타임 예외(구현: {@code
   * DriveQuotaExceededException}, 409)를 던진다.
   *
   * <p>잠금이 트랜잭션 끝까지 유지되도록, 저장(바이트 쓰기·file INSERT)과 같은 트랜잭션 안에서 저장 전에 부른다.
   */
  void assertWithinQuotaLocked(long incomingBytes);
}
