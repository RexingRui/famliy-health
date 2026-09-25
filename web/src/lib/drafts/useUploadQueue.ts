import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { invalidateAfterWrite } from '../../api/hooks'
import { uploadQueue } from './queue'

export function useUploadQueue() {
  return useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getState)
}

/**
 * Keeps the queue moving while the app is open: on start, when the network comes back and
 * when the page returns to the foreground. Server data is refreshed after each upload.
 */
export function useUploadQueueRunner() {
  const qc = useQueryClient()
  useEffect(() => {
    const flush = () => void uploadQueue.flush()
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush()
    }
    const offSynced = uploadQueue.onSynced(() => invalidateAfterWrite(qc))
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', onVisible)
    flush()
    return () => {
      offSynced()
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [qc])
}
