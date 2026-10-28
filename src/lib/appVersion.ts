// So phiên bản app đang chạy với /version.json mới nhất trên server (file này do vite.config.ts sinh ra mỗi lần build)
export const LOCAL_BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

// Bản dev không có version.json thật nên không bao giờ coi là cũ
export const isOutdated = (local: string, remote: string | null): boolean => local !== 'dev' && remote !== null && remote !== local

export async function fetchRemoteBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    const data = (await res.json()) as { id?: unknown }
    return typeof data.id === 'string' ? data.id : null
  } catch {
    return null
  }
}
