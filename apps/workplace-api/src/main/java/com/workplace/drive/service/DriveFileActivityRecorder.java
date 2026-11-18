package com.workplace.drive.service;

import com.workplace.drive.domain.DriveFileAction;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.repository.DriveFileActivityRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 드라이브 「최근」 기록(WP-1699)의 쓰기 입구 — 열기·올리기·새 판 지점이 부른다.
 *
 * <p>기록은 부가 기능이라 본 요청(열기·업로드)을 절대 막지 않는다. 그래서 (1) 호출 트랜잭션이 커밋된 <b>뒤</b>에 쓰고(새로 만든 drive_file 이 커밋
 * 전이면 REQUIRES_NEW 트랜잭션에서 안 보여 FK 위반이 난다), (2) 모든 예외를 여기서 잡아 로그만 남긴다. 실제 쓰기는 {@link
 * DriveFileActivityRepository#upsert}(REQUIRES_NEW).
 *
 * <p>가능하면 트랜잭션 밖(컨트롤러)에서 부른다 — 커밋 콜백 안에서 REQUIRES_NEW 를 열면 요청 커넥션이 아직 반납되기 전이라 커넥션을 둘 쓰기 때문이다. 트랜잭션
 * 안에서 불리면 afterCommit 으로 미룬다(롤백이면 쓰지 않는다).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DriveFileActivityRecorder {
  private final DriveFileActivityRepository repository;

  /**
   * 행동을 기록한다. 트랜잭션 동기화가 켜져 있으면 커밋 뒤로 미루고, 아니면 바로 쓴다. 어떤 예외도 호출자에게 던지지 않는다.
   *
   * @param userId 행위자(AI 키로 들어오면 그 AI 의 id)
   */
  public void record(long userId, long driveFileId, DriveFileAction action) {
    if (!TransactionSynchronizationManager.isSynchronizationActive()) {
      write(userId, driveFileId, action);
      return;
    }
    try {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              write(userId, driveFileId, action);
            }
          });
    } catch (RuntimeException e) {
      warn(userId, driveFileId, action, e);
    }
  }

  /** 업로드 결과를 기록한다 — 새 파일(versionCount 1)은 UPLOAD, 같은 이름에 새 판으로 흡수됐으면(2 이상) NEW_VERSION. */
  public void recordSaved(long userId, DriveFileResponse saved) {
    record(
        userId,
        saved.id(),
        saved.versionCount() > 1 ? DriveFileAction.NEW_VERSION : DriveFileAction.UPLOAD);
  }

  /** 실제 쓰기 — 실패(FK 위반·DB 오류 등)는 삼키고 로그만 남긴다. */
  private void write(long userId, long driveFileId, DriveFileAction action) {
    try {
      repository.upsert(userId, driveFileId, action);
    } catch (RuntimeException e) {
      warn(userId, driveFileId, action, e);
    }
  }

  private static void warn(long userId, long driveFileId, DriveFileAction action, Exception e) {
    log.warn(
        "드라이브 최근 기록 실패(무시) userId={} driveFileId={} action={}: {}",
        userId,
        driveFileId,
        action,
        e.toString());
  }
}
