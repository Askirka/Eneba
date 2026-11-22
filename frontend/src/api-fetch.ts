export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const readOnly = !init?.method || init.method === 'GET' || path === '/api/cart/quote'
  if (!readOnly) return fetch(path, init)

  for (const delay of [1000, 2000, 4000, 8000, 15000, 15000, 15000]) {
    try {
      const response = await fetch(path, init)
      const warming = [502, 503, 504].includes(response.status) ||
        (response.ok && response.headers.get('Content-Type')?.includes('text/html'))
      if (!warming) return response
      void response.body?.cancel()
    } catch (error) {
      if (init?.signal?.aborted) throw error
    }
    await pause(delay, init?.signal)
  }
  return fetch(path, init)
}

function pause(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    function abort() { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
