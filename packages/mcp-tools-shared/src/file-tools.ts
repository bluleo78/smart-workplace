// src/file-tools.ts — 첨부용 파일 올려 두기(upload_file, WP-421). 두 앱 공유.
// 외부 MCP 는 바이트를 JSON 본문으로 보낼 수 없어(4MB 상한·secretless) 파일을 먼저 스테이징하고, 받은 fileId 를 이슈·메시지·노트 쓰기 도구의
// fileIds 입력으로 붙인다(WP-422~424). 어느 도메인에 붙일지는 클레임 때 그 도메인이 자기 권한으로 정하므로 이 도구는 대상을 받지 않는다.
// content 가 있으면 텍스트로 바로 만들고, 없으면 일회용 PUT 링크를 준다 — create_drive_file(WP-369)과 같은 두 갈래다.
import { z } from 'zod';
import { curlPutHowTo, UPLOAD_LINK_NOTE_COMMON } from './drive-view.js';
import type { SharedTool } from './mcp-tool.js';
import { nullAsOmitted } from './tool-definitions.js';
import type { FileToolClient, StagedUploadLink } from './tool-client.js';

// content 가 있으면(빈 문자열 포함 — 빈 파일) 텍스트로 쓰고, 없거나 null 이면 업로드 링크를 발급한다(모델이 쓰지 않는 입력을 null 로 채워 보내기도 한다).
// 이름 상한은 서버 CreateStagedTextRequest·CreateStagedLinkRequest 와 같은 255자.
export const uploadFileInput = z.object({
  name: z.string().min(1).max(255),
  content: nullAsOmitted(z.string()),
});

/**
 * upload_file 설명의 content 모드 부분(무엇을 하는지·텍스트 쓰기). 업로드 링크를 쓸 수 없는 판(allowUploadLink: false)은 이 부분만 한국어 머리말 뒤에
 * 붙인다(CREATE_DRIVE_FILE_CONTENT_DESCRIPTION 과 같은 구조). 붙일 도구는 이름 대신 입력(fileIds)으로 가리킨다 — 도구 이름을 적으면
 * 앱 범위 교차 참조 규칙(tool-apps.test.ts)에 걸리고, 세 앱의 도구를 모두 나열하면 정의 크기만 커진다.
 */
export const UPLOAD_FILE_CONTENT_DESCRIPTION =
  'Stages a file to attach (fileIds input of issue, message and wiki tools) within 24 hours. With content: saves that text (md, txt, csv, json; ' +
  'else plain text).';
/** upload_file 설명의 업로드 링크 부분 — 셸이 있는 외부 클라이언트용. 실패·만료 안내는 응답 note 에 싣는다(정의 크기 절약). */
const UPLOAD_FILE_LINK_DESCRIPTION =
  'Without: returns a one-time upload link valid 10 minutes, up to maxBytes: curl -T <file> "<uploadUrl>" prints fileId.';

/**
 * 스테이징 업로드 링크 발급 응답 → LLM 뷰(WP-421). 드라이브 업로드 링크 뷰(toDriveUploadLinkView)와 같이 **허용 목록**으로 고른다 —
 * 로그인 없이 쓸 수 있는 링크라 서버에 나중에 생길 필드(발급자 id 등)가 외부 클라이언트로 새지 않게 한다. url 은 uploadUrl 로 바꿔
 * 다운로드 링크(url)와 헷갈리지 않게 하고, 그대로 붙여 쓸 curl 명령(howTo)과 결과·실패 시 행동(note)을 싣는다.
 */
export function toStagedUploadLinkView({ url, method, expiresAt, maxBytes, name, singleUse }: StagedUploadLink) {
  return {
    uploadUrl: url,
    method,
    expiresAt,
    maxBytes,
    name,
    singleUse,
    howTo: curlPutHowTo(url),
    note:
      UPLOAD_LINK_NOTE_COMMON +
      'PUT 응답 JSON 의 fileId 를 첨부 입력(fileIds)에 넘기세요. 24시간 안에 붙이지 않으면 파일이 사라집니다. ' +
      '전송이 실패하면 이 링크는 다시 쓸 수 없으니 upload_file 로 새 링크를 만드세요.',
  };
}

/**
 * 업로드 링크를 쓸 수 없는 판(웹 AI Chat — 사용자에게 셸이 없다)의 설명 머리말. 링크·curl 안내 대신 content 모드만 말한다(쓸 수 없는 지시는 모델을
 * 헷갈리게 하고 토큰만 든다).
 */
const UPLOAD_FILE_CONTENT_ONLY_PREFIX =
  'AI Chat 에서는 content(직접 쓴 텍스트)로 첨부용 파일을 만들 때만 쓰세요. 업로드 링크(content 생략)는 만들 수 없습니다 — 사용자의 로컬 파일은 ' +
  '웹 화면에서 직접 첨부하라고 안내하세요. ';

/** 파일 도구 옵션 — allowUploadLink(기본 true): false 면 upload_file 이 content 모드만 받는다(설명·핸들러 모두). create_drive_file 과는 무관하다. */
export interface FileToolOptions {
  allowUploadLink?: boolean;
}

/** 파일 도구(upload_file). */
export function buildFileTools(client: FileToolClient, { allowUploadLink = true }: FileToolOptions = {}): SharedTool[] {
  return [
    {
      name: 'upload_file',
      // 이슈 첨부·메시지 첨부·노트 이미지의 공통 선행 단계라 세 앱 어느 쪽만 골라도 보여야 한다(README 앱 분류).
      app: ['issue', 'messaging', 'wiki'],
      kind: 'write',
      // 새 임시 파일이나 링크를 만들기만 한다(덮어쓰지 않음). 부를 때마다 새 파일·링크가 생겨 비멱등.
      hints: { destructive: false, idempotent: false },
      description: allowUploadLink
        ? `${UPLOAD_FILE_CONTENT_DESCRIPTION} ${UPLOAD_FILE_LINK_DESCRIPTION}`
        : UPLOAD_FILE_CONTENT_ONLY_PREFIX + UPLOAD_FILE_CONTENT_DESCRIPTION,
      inputSchema: uploadFileInput,
      async handler(args) {
        // 링크를 쓸 수 없는 판은 content 가 없으면 API 를 부르지 않고(입력 검사보다 먼저) 안내 오류를 낸다.
        if (!allowUploadLink && (args as { content?: unknown } | null)?.content == null) {
          throw new Error(
            'AI Chat 에서는 업로드 링크를 만들 수 없습니다. 첨부할 내용을 content 로 넘겨 파일을 만들고, 로컬 파일은 웹 화면에서 직접 첨부하라고 안내하세요.',
          );
        }
        const { name, content } = uploadFileInput.parse(args);
        // 빈 문자열도 content 다(빈 파일) — 진릿값으로 가르면 ""가 업로드 링크로 새어 나간다.
        if (content != null) {
          // 서버 StagedFileResponse {fileId, name, sizeBytes, mimeType, expiresAt} 그대로 — 사용자 id 가 없고 다른 뷰처럼 제거 목록도 필요 없다.
          return JSON.stringify(await client.createStagedTextFile(name, content));
        }
        return JSON.stringify(toStagedUploadLinkView(await client.createStagedUploadLink(name)));
      },
    },
  ];
}
