import { useEffect, useState } from 'react'

/**
 * DOCX 를 mammoth(lazy import)로 HTML 변환 후 sandbox iframe(srcDoc)으로 격리 렌더한다.
 * 문서 내용은 신뢰 불가(외부 파일) → 스크립트·same-origin 불허 sandbox 로 XSS 차단(#486 패턴).
 * mammoth 는 Vite browser 필드로 브라우저 번들이 해석된다(node fs 의존 없음).
 */
export function DocxPreview({ buffer }: { buffer: ArrayBuffer }) {
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        // UMD interop: convertToHtml 이 네임스페이스 또는 .default 에 있을 수 있다.
        const mod = (await import('mammoth')) as {
          convertToHtml?: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>
          default?: {
            convertToHtml?: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>
          }
        }
        const convertToHtml = mod.convertToHtml ?? mod.default?.convertToHtml
        if (!convertToHtml) throw new Error('mammoth.convertToHtml 을 찾지 못함(import interop)')
        const result = await convertToHtml({ arrayBuffer: buffer })
        if (alive) setHtml(result.value)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [buffer])

  if (failed) return <p className="text-sm text-destructive">문서를 읽지 못했습니다.</p>
  if (html == null) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  return (
    <iframe
      data-testid="docx-document"
      title="문서 미리보기"
      sandbox=""
      srcDoc={html}
      className="h-[70vh] w-full border-0"
    />
  )
}
