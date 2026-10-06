package com.workplace.home.service;

import com.workplace.chat.service.ChatMessageAttachmentStorage;
import com.workplace.file.storage.StorageDomain;
import com.workplace.home.dto.HomeUploadedFile;
import com.workplace.home.exception.HomeAttachmentInvalidException;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 메인 AI 채팅 첨부(WP-234) — 호출자 단위 선업로드, 전송 시 연결·승격·추출 요청, 세션 첨부 조회·읽기.
 *
 * <p>업로드는 세션이 아니라 호출자 단위다(새 대화의 첫 메시지 전에는 세션이 없다). 모든 메서드는 트랜잭션 안에서 돈다 — file·정션이 RLS 대상이라 GUC 가
 * 필요하다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class HomeAttachmentService {

  /** 세션당 첨부 상한 — 매 턴 프롬프트에 싣는 목록 크기를 묶는다. */
  public static final int MAX_PER_SESSION = 30;

  static final String MSG_NO_FILES = "업로드할 파일이 없어요.";
  static final String MSG_TOO_LARGE = "파일 하나는 25MB 까지 첨부할 수 있어요.";

  /** 이슈 챗과 같은 임시 저장 구현 — 도메인만 HOME 으로 지정해 경로를 분리한다. */
  private final ChatMessageAttachmentStorage storage;

  /** 파일 1개당 최대 크기(바이트) — 이슈 챗과 같은 설정. */
  @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}")
  private long maxFileSize;

  /** 요청(메시지)당 최대 첨부 수 — 이슈 챗과 같은 설정. */
  @Value("${workplace.storage.attachment.max-per-message:10}")
  private int maxPerMessage;

  /**
   * 선업로드 — 개수·크기를 먼저 모두 검사한 뒤 저장한다(일부만 저장되고 400 이 나는 일이 없게). 반환한 fileId 를 전송(fileIds)에 쓴다.
   *
   * @throws HomeAttachmentInvalidException 파일 없음·개수 초과·크기 초과
   */
  public List<HomeUploadedFile> upload(long callerId, List<MultipartFile> files) {
    if (files == null || files.isEmpty()) throw new HomeAttachmentInvalidException(MSG_NO_FILES);
    if (files.size() > maxPerMessage) throw new HomeAttachmentInvalidException(tooManyMessage());
    for (MultipartFile mf : files) {
      if (mf.getSize() > maxFileSize) throw new HomeAttachmentInvalidException(MSG_TOO_LARGE);
    }
    List<HomeUploadedFile> out = new ArrayList<>();
    for (MultipartFile mf : files) {
      // 저장소와 같은 규칙으로 표시 이름을 정한다(null → "file").
      String name = mf.getOriginalFilename() != null ? mf.getOriginalFilename() : "file";
      ChatMessageAttachmentStorage.Stored stored;
      try {
        stored = storage.storeTemporary(mf, callerId, StorageDomain.HOME);
      } catch (IOException e) {
        throw new UncheckedIOException("첨부 저장 실패", e);
      }
      out.add(new HomeUploadedFile(stored.fileId(), name, stored.mimeType(), mf.getSize()));
    }
    return out;
  }

  /** 개수 초과 문구 — 설정값을 그대로 보여 준다. */
  String tooManyMessage() {
    return "한 번에 첨부할 수 있는 파일은 최대 " + maxPerMessage + "개예요.";
  }
}
