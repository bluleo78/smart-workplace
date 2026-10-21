package com.workplace.drive.service;

import static com.workplace.jooq.Tables.FILE;

import com.workplace.file.service.FileUploadService;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 드라이브가 파일 바이트를 새 file 로 복제하는 곳(파일 복사·폴더 복사·버전 되돌리기)의 공용 경로(WP-695).
 *
 * <p>복제한 file 에도 업로드와 같은 내용 추출(FULL: 텍스트·요약·임베딩)을 요청한다. 예전엔 세 곳 모두 {@link
 * FileUploadService#copyFile} 만 불러 추출 행이 생기지 않았고, 드라이브에는 빠진 추출을 채우는 백필 소스도 없어 복사본·되돌린 버전이 내용 검색·AI
 * 요약·AI 읽기에서 영구히 빠졌다. 미리보기 변환은 첫 열람 때 하므로 여기서 요청하지 않는다.
 */
@Component
@RequiredArgsConstructor
public class DriveBlobCopier {

  private final FileUploadService fileUpload;
  private final ApplicationEventPublisher eventPublisher;
  private final DSLContext dsl;

  /**
   * srcFileId 의 바이트를 새 영구 file 로 복제하고 내용 추출을 요청한다. 추출 행은 같은 트랜잭션에서 생기고 커밋 후 워커로 디스패치된다(업로드와 같은 경로).
   *
   * @return 새 FILE.id
   */
  public long copy(long srcFileId, long callerId) throws IOException {
    long newFileId = fileUpload.copyFile(srcFileId, callerId);
    String mime =
        dsl.select(FILE.MIME_TYPE).from(FILE).where(FILE.ID.eq(newFileId)).fetchOne(FILE.MIME_TYPE);
    eventPublisher.publishEvent(
        FileExtractionRequestedEvent.of(newFileId, mime, ExtractionProfile.FULL));
    return newFileId;
  }
}
