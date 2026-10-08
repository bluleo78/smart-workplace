// E2E 공용 샘플 바이트(WP-279) — 뷰어 목(메일·채팅)이 같은 PDF 를 각자 읽지 않게 한 곳에서 내보낸다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 3쪽짜리 실제 PDF — pdf.js 렌더(쪽 수·캔버스)를 확인할 때 쓴다. */
export const SAMPLE_PDF = fs.readFileSync(path.join(HERE, 'sample-3p.pdf'))

/** 10초 실제 영상(VP8+Opus 160×120) — 뷰어 영상 재생 E2E(WP-281). */
export const SAMPLE_WEBM = fs.readFileSync(path.join(HERE, 'sample-10s.webm'))
/** 10초 실제 오디오(MP3) — 뷰어 오디오 재생 E2E(WP-281). */
export const SAMPLE_MP3 = fs.readFileSync(path.join(HERE, 'sample-10s.mp3'))
