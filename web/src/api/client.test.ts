import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from './client'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    stubFetch(200, { status: 'ok' })
    await expect(apiFetch('/healthz')).resolves.toEqual({ status: 'ok' })
  })

  it('throws ApiError with the unified error body', async () => {
    stubFetch(422, {
      error: { code: 'validation_failed', message: '体温需在 34.0 到 43.0 之间', fields: { temperature: 'out_of_range' } },
    })
    const err = await apiFetch('/api/records/1', { method: 'PUT', body: '{}' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'validation_failed', fields: { temperature: 'out_of_range' } })
  })
})
