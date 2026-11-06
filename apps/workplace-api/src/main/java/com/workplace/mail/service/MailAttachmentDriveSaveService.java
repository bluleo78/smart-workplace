package com.workplace.mail.service;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveUploadLimits;
import com.workplace.file.exception.FileSizeLimitExceededException;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.UploadSource;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.service.MailAttachmentResolver.Resolved;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import java.io.IOException;
import java.io.UncheckedIOException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 첨부를 드라이브에 새 파일로 저장(WP-1400). 메일 첨부는 file 행이 없어(메일 서버에 원본이 있다) 이슈·채팅 첨부처럼 같은 file 을 가리키는
 * 가져오기(import-attachment)를 쓸 수 없다 — 원본 바이트를 받아 드라이브 업로드와 같은 경로(한도·추출·미리보기·감사·알림)로 새 파일 + v1 을 만든다.
 *
 * <p>메일 서버를 기다리는 동안 DB 연결을 잡지 않도록 이 메서드에는 트랜잭션을 두지 않는다. 순서:
 *
 * <ol>
 *   <li>짧은 읽기 트랜잭션: 소유 확인(남의 첨부·비활성 계정이면 404)·형식 정규화({@link MailAttachmentResolver} — /view·/text 와
 *       같은 mime)·manifest 크기로 크기 한도 사전 검사(400).
 *   <li>짧은 읽기 트랜잭션: 대상 확인(EDITOR·같은 공간 폴더)·같은 이름 확인(409)·manifest 크기를 알면 저장 한도 확인(409, 잠금 없이) — 받기
 *       전에 거절해 헛걸음을 막는다.
 *   <li>트랜잭션 없음: 원본 받기({@link MailAttachmentService#downloadForPreview} — 캐시에 있으면 메일 서버를 부르지 않고, 캐시
 *       blob 이 상한을 넘으면 읽기 전에 거절한다). 받은 실제 바이트로 크기 한도를 다시 본다(manifest 크기가 없거나 틀릴 수 있다).
 *   <li>업로드 트랜잭션: {@link DriveFileService#uploadNew} — 같은 이름이면 새 버전으로 덮지 않고 409(그 사이 생긴 이름도 다시 본다).
 * </ol>
 *
 * <p>mail → drive.service 방향 의존은 messaging 등 다른 도메인이 드라이브를 쓰는 것과 같다(drive 는 mail 을 모른다).
 */
@Service
@RequiredArgsConstructor
public class MailAttachmentDriveSaveService {

  private final MailAttachmentResolver resolver;
  private final MailAttachmentService attachmentService;
  private final DriveFileService driveFileService;
  private final DriveUploadLimits uploadLimits;
  private final PlatformTransactionManager txManager;

  /**
   * 내 메일 첨부를 드라이브 공간·폴더에 새 파일로 저장한다.
   *
   * @param folderId 대상 폴더, null 이면 공간 루트
   * @return 만든 드라이브 파일(드라이브 import-attachment 와 같은 응답)
   * @throws EmailAttachmentNotFoundException 없거나 남의 첨부·비활성 계정(404), 원본이 메일 서버에 없을 때(404)
   * @throws com.workplace.drive.exception.DriveSpaceNotFoundException 공간 비멤버(404, 존재 은닉)
   * @throws com.workplace.drive.exception.DriveForbiddenException EDITOR 미만·보관된 공간(403)
   * @throws com.workplace.drive.exception.DriveFolderNotFoundException 없거나 휴지통 폴더(404)
   * @throws com.workplace.drive.exception.DriveInvalidTargetException 다른 공간의 폴더(400)
   * @throws com.workplace.drive.exception.DriveDuplicateNameException 같은 폴더에 같은 이름(409)
   * @throws com.workplace.drive.exception.DriveQuotaExceededException 저장 한도 초과(409) — manifest 크기로
   *     알면 받기 전에
   * @throws FileSizeLimitExceededException 형식별 크기 상한·드라이브 업로드 상한 초과(400) — manifest 크기로 알면 받기 전에
   */
  public DriveFileResponse save(long userId, long attachmentId, long spaceId, Long folderId) {
    // ① 소유 확인 — RLS 때문에 트랜잭션 안에서 읽는다(밖이면 빈 결과로 거짓 404). manifest 크기도 같이 읽는다.
    TransactionTemplate readTx = new TransactionTemplate(txManager);
    readTx.setReadOnly(true);
    Resolved resolved = readTx.execute(s -> resolver.resolve(userId, attachmentId));
    String name = MailAttachmentResolver.displayNameOf(resolved.ctx());
    String contentType = resolved.mime();

    // ①-2 크기 사전 검사 — manifest 크기가 정규화한 형식의 범주 상한·드라이브 업로드 상한을 넘으면 메일 서버에서 받기 전에 거절한다.
    String category = FileUploadService.categoryOf(contentType);
    long maxBytes = uploadLimits.capFor(name, contentType);
    if (resolved.exceedsBeforeFetch(maxBytes)) {
      throw new FileSizeLimitExceededException(category, maxBytes, name);
    }

    // ② 대상·같은 이름·저장 한도 사전 검사(자기 읽기 트랜잭션) — 메일 서버에서 받기 전에 거절할 수 있는 것은 모두 거절한다.
    driveFileService.validateNewFileTarget(
        userId, spaceId, folderId, name, resolved.minActualBytesBeforeFetch());

    // ③ 원본 받기 — 트랜잭션 밖(메일 서버 응답을 기다리는 동안 DB 연결을 잡지 않는다). 실패는 /content 와 같은 예외로 전파한다.
    // 캐시에 있으면 blob 실제 크기로 읽기 전에 상한을 본다(큰 blob 을 메모리에 올리지 않는다).
    AttachmentDownload dl =
        attachmentService.downloadForPreview(
            userId,
            resolved.ctx(),
            size -> {
              if (size > maxBytes)
                throw new FileSizeLimitExceededException(category, maxBytes, name);
            });
    // 받은 실제 바이트로 다시 본다 — manifest 크기가 없거나(레거시) 틀릴 수 있고, file core 는 범주 상한만 보므로 드라이브 상한은 여기서 건다.
    if (dl.content().length > maxBytes) {
      throw new FileSizeLimitExceededException(category, maxBytes, name);
    }

    // ④ 새 파일로 저장 — 할당량 잠금 아래에서 같은 이름·한도를 다시 보고, 같은 이름이 있으면 버전 흡수 대신 409.
    try {
      return driveFileService.uploadNew(
          userId, spaceId, folderId, UploadSource.ofBytes(name, contentType, dl.content()));
    } catch (IOException e) {
      throw new UncheckedIOException("드라이브에 첨부를 저장하지 못했습니다", e);
    }
  }
}
