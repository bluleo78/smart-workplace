// 노트 본문 파일 첨부(WP-1545) 공용 규칙 — 본문 링크 주소 판별·업로드 사전 검사·업로드 응답 메타 기억.
// 순수 함수 위주(vitest 대상). 최종 판정(형식·크기)은 서버가 다시 한다 — 여기 검사는 요청 전에 알려 주는 UX 용이다.

import { ACCEPTED_IMAGE_TYPES, INVALID_IMAGE_MSG, isValidImageFile } from './imageUpload'

/** 이미지가 아닌 첨부의 크기 상한(25MB) — 서버 workplace.storage.wiki.max-file-size-bytes 기본값과 같다. */
export const WIKI_MAX_FILE_BYTES = 25 * 1024 * 1024

/** 본문 링크가 가리키는 노트 첨부 — 앱 경로(로그인)와 공개 공유 경로(서버 마스커가 바꾼 주소) 둘 다. */
export interface WikiAttachmentLink {
  pageId: number
  fileId: number
  /** 본문에 적힌 주소(쿼리·조각 뗀 것) — 받기·다운로드 경로로 그대로 쓴다. */
  url: string
  /** 공개 공유 경로면 그 토큰, 앱 경로면 null. */
  publicToken: string | null
}

// 서버 WikiAttachmentResponse.urlOf 와 WikiAttachmentService.ATTACHMENT_URL 이 정한 앱 경로 — 한쪽만 바꾸면 칩이 되지 않는다.
const APP_PATH = /^\/api\/v1\/wiki\/pages\/(\d{1,19})\/attachments\/(\d{1,19})\/content$/
// 공개 공유 화면 본문의 첨부 주소(WikiPublicMarkdownMasker 가 앱 경로를 이 모양으로 바꾼다 — 끝에 /content 가 없다).
const PUBLIC_PATH = /^\/api\/v1\/public\/wiki\/shares\/([^/?#]+)\/pages\/(\d{1,19})\/attachments\/(\d{1,19})$/

/**
 * 링크 주소가 노트 첨부 주소인지 판별한다 — 맞으면 페이지·파일 id, 아니면 null.
 * 상대 경로만 본다(본문에는 서버가 준 상대 경로가 들어간다). 쿼리·조각은 떼고 비교한다.
 */
export function parseWikiAttachmentUrl(href: string | null | undefined): WikiAttachmentLink | null {
  if (!href) return null
  const path = href.split(/[?#]/, 1)[0]
  const app = APP_PATH.exec(path)
  if (app) return { pageId: Number(app[1]), fileId: Number(app[2]), url: path, publicToken: null }
  const pub = PUBLIC_PATH.exec(path)
  if (pub) return { pageId: Number(pub[2]), fileId: Number(pub[3]), url: path, publicToken: pub[1] }
  return null
}

/**
 * 업로드 갈래 — 서버가 매직바이트로 이미지로 볼 4종(PNG·JPEG·GIF·WebP)이면 이미지(본문 그림), 그 밖은 파일(링크 칩).
 * SVG·HEIC 등 그 밖의 image/* 도 파일로 간다(서버가 이미지로 보지 않는다).
 */
export function wikiUploadKind(file: Pick<File, 'type'>): 'image' | 'file' {
  return ACCEPTED_IMAGE_TYPES.has(file.type) ? 'image' : 'file'
}

/** 첨부 크기 초과 안내 — 서버(FileSizeLimitExceededException.attachmentMessage)와 같은 문구. */
export function wikiFileTooLargeMessage(name: string): string {
  return `첨부 파일은 최대 25MB까지 업로드할 수 있습니다: ${name}`
}

/**
 * 업로드 전 거절 사유 — 없으면 null. 이미지는 예전 규칙(4종·10MB, 이슈 본문과 같은 문구), 파일은 25MB.
 * 빈 파일·형식 판정은 서버가 한다.
 */
export function wikiUploadRejection(file: File): string | null {
  if (wikiUploadKind(file) === 'image') return isValidImageFile(file) ? null : INVALID_IMAGE_MSG
  return file.size > WIKI_MAX_FILE_BYTES ? wikiFileTooLargeMessage(file.name) : null
}

// 파일 이름처럼 보이는 줄 — 확장자(.xxx)로 끝나고, 길지 않고, 빈칸이 많지 않다(문장이 아니다).
// 경로째 실렸으면 마지막 조각만 본다.
const FILE_NAME_MAX = 255
function looksLikeFileName(line: string): boolean {
  const base = line.split(/[\\/]/).pop() ?? line
  if (base.length === 0 || base.length > FILE_NAME_MAX) return false
  if (!/\.[A-Za-z0-9]{1,10}$/.test(base)) return false
  const spaces = (base.match(/\s/g) ?? []).length
  return spaces <= 5 && !/[.!?。]\s/.test(base)
}

/**
 * 클립보드 글자가 붙여넣는 파일 이름뿐인지 — Finder 등에서 파일을 복사하면 text/plain 에 파일 이름이 함께 실린다.
 * 이때 글자까지 붙여 넣으면 칩 옆에 이름이 한 번 더 들어가므로, 이름뿐이면 「잃을 글자가 없는」 붙여넣기로 본다.
 *
 * <p>Finder 에서 여러 파일을 복사하면 이름은 전부 실리는데 File 은 그보다 적게 실린다 — 그래서 「모든 줄이 File 이름」이
 * 아니라 「모든 File 이름이 줄에 있고, 나머지 줄도 파일 이름처럼 보인다(문장이 아니다)」로 판정한다.
 */
export function clipboardTextIsFileNames(text: string, files: readonly Pick<File, 'name'>[]): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return true
  if (files.length === 0) return false
  const baseOf = (l: string) => l.split(/[\\/]/).pop() ?? l
  const fileNames = new Set(files.map((f) => f.name))
  const namesFile = (l: string) => fileNames.has(l) || fileNames.has(baseOf(l))
  // 모든 줄이 실린 File 의 이름이면 그대로 이름뿐이다.
  if (lines.every(namesFile)) return true
  // Finder 여러 파일 복사 — 모든 File 이름이 줄에 있고, 나머지 줄도 파일 이름처럼 보여야 한다(문장이 섞였으면 기본 붙여넣기).
  const lineNames = new Set(lines.flatMap((l) => [l, baseOf(l)]))
  return files.every((f) => lineNames.has(f.name)) && lines.every((l) => namesFile(l) || looksLikeFileName(l))
}

/** 브라우저가 인라인으로 보이는 4종(PNG·JPEG·GIF·WebP) 밖의 이미지(TIFF·HEIC·SVG 등) — 그림이 아니라 파일로 첨부된다. */
export function isNonInlineImage(file: Pick<File, 'type'>): boolean {
  return file.type.startsWith('image/') && wikiUploadKind(file) === 'file'
}

/** 4종 밖의 이미지를 파일로 첨부했을 때 알리는 문구. */
export const NON_INLINE_IMAGE_NOTICE = 'PNG·JPEG·GIF·WebP 가 아니라 파일로 첨부했습니다.'

/** 폴더를 드롭했을 때 알리는 문구 — 폴더는 올릴 수 없다. */
export const FOLDER_DROP_REJECTED_MSG = '폴더는 첨부할 수 없습니다.'

/**
 * 드롭된 항목에서 폴더를 뺀 파일들 — 폴더를 dataTransfer.files 그대로 올리면 0바이트 이름만 있는 항목이 올라간다.
 * items 의 webkitGetAsEntry() 로 폴더를 알아보고(files 와 같은 순서), 그 API 가 없으면 크기 0·형식 없음을 폴더로 본다.
 */
export function droppedFilesWithoutFolders(dt: Pick<DataTransfer, 'files' | 'items'>): { files: File[]; skippedFolder: boolean } {
  const files = Array.from(dt.files ?? [])
  const fileItems = Array.from(dt.items ?? []).filter((it) => it.kind === 'file')
  const canInspect = fileItems.length === files.length && fileItems.some((it) => typeof it.webkitGetAsEntry === 'function')
  let skippedFolder = false
  const kept = files.filter((f, i) => {
    const folder = canInspect
      ? (fileItems[i].webkitGetAsEntry?.()?.isDirectory ?? false)
      : f.size === 0 && f.type === ''
    if (folder) skippedFolder = true
    return !folder
  })
  return { files: kept, skippedFolder }
}

/** 칩이 보여 줄 첨부 메타 — 이 화면에서 올린 파일만 안다(목록 API 를 따로 두지 않는다). */
export interface WikiAttachmentMeta {
  name: string
  mimeType: string
  sizeBytes: number
}

// 업로드 응답 기억 — 주소 → 메타. 본문에는 링크(이름·주소)만 남으므로 크기·형식은 이 화면에서 올린 파일만 안다.
// 한 탭이 올리는 첨부 수는 적어 상한을 두지 않는다(새로고침하면 비워진다).
const metaByUrl = new Map<string, WikiAttachmentMeta>()

/** 업로드 응답을 기억한다 — 칩이 크기·형식을 보이고 뷰어가 형식을 정하는 데 쓴다. */
export function rememberWikiAttachment(a: { url: string; originalName: string; mimeType: string; sizeBytes: number }) {
  metaByUrl.set(a.url, { name: a.originalName, mimeType: a.mimeType, sizeBytes: a.sizeBytes })
}

/** 기억한 업로드 메타 — 이 화면에서 올리지 않았으면 undefined. */
export function wikiAttachmentMeta(url: string): WikiAttachmentMeta | undefined {
  return metaByUrl.get(url)
}
