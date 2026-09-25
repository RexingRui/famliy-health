import { keepPreviousData, useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'
import * as api from './endpoints'
import type { ByDiseaseRange } from './types'

/** Query keys. Invalidating a prefix ("records", "episodes", …) refreshes every view built on it. */
export const keys = {
  me: ['me'] as const,
  home: ['home'] as const,
  members: (includeArchived = false) => ['members', { includeArchived }] as const,
  member: (id: string) => ['members', id] as const,
  byDisease: (id: string, range: ByDiseaseRange) => ['members', id, 'by-disease', range] as const,
  memberCalendar: (id: string, month: string) => ['calendar', 'member', id, month] as const,
  diseaseTags: ['disease-tags'] as const,
  episodes: (f: api.EpisodeFilter = {}) => ['episodes', f] as const,
  episode: (id: string) => ['episodes', 'detail', id] as const,
  episodeCalendar: (id: string, month: string) => ['calendar', 'episode', id, month] as const,
  trend: (id: string) => ['trend', id] as const,
  records: (f: api.RecordFilter) => ['records', f] as const,
  record: (id: string) => ['records', 'detail', id] as const,
  lastMedication: (memberId: string, medName: string) => ['medications', memberId, medName] as const,
}

/** After any record, episode or member write: everything derived from records may have changed. */
export function invalidateAfterWrite(qc: QueryClient) {
  for (const k of ['home', 'members', 'episodes', 'records', 'calendar', 'trend', 'medications']) {
    void qc.invalidateQueries({ queryKey: [k] })
  }
}

/** The signed-in account, or null when there is no session. */
export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.getMe()
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
  })

export const useHome = () => useQuery({ queryKey: keys.home, queryFn: api.getHome })

export const useMembers = (includeArchived = false) =>
  useQuery({ queryKey: keys.members(includeArchived), queryFn: () => api.listMembers(includeArchived) })

export const useMember = (id: string | undefined) =>
  useQuery({ queryKey: keys.member(id ?? ''), queryFn: () => api.getMember(id!), enabled: !!id })

export const useByDisease = (id: string, range: ByDiseaseRange) =>
  useQuery({
    queryKey: keys.byDisease(id, range),
    queryFn: () => api.getMemberByDisease(id, range),
    placeholderData: keepPreviousData,
  })

export const useMemberCalendar = (id: string, month: string) =>
  useQuery({
    queryKey: keys.memberCalendar(id, month),
    queryFn: () => api.getMemberCalendar(id, month),
    placeholderData: keepPreviousData,
  })

export const useDiseaseTags = () => useQuery({ queryKey: keys.diseaseTags, queryFn: api.listDiseaseTags })

export const useEpisodes = (f: api.EpisodeFilter, enabled = true) =>
  useQuery({ queryKey: keys.episodes(f), queryFn: () => api.listEpisodes(f), enabled })

export const useEpisode = (id: string | undefined) =>
  useQuery({ queryKey: keys.episode(id ?? ''), queryFn: () => api.getEpisode(id!), enabled: !!id })

export const useEpisodeCalendar = (id: string, month: string) =>
  useQuery({
    queryKey: keys.episodeCalendar(id, month),
    queryFn: () => api.getEpisodeCalendar(id, month),
    placeholderData: keepPreviousData,
  })

export const useEpisodeTrend = (id: string) =>
  useQuery({ queryKey: keys.trend(id), queryFn: () => api.getEpisodeTrend(id) })

export const useRecord = (id: string | undefined) =>
  useQuery({ queryKey: keys.record(id ?? ''), queryFn: () => api.getRecord(id!), enabled: !!id })

/** Cursor-paginated record list; pages are flattened by the caller. */
export const useRecordList = (f: api.RecordFilter, enabled = true) =>
  useInfiniteQuery({
    queryKey: keys.records(f),
    queryFn: ({ pageParam }) => api.listRecords(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  })

export const useLastMedication = (memberId: string | undefined, medName: string) =>
  useQuery({
    queryKey: keys.lastMedication(memberId ?? '', medName),
    queryFn: () => api.getLastMedication(memberId!, medName),
    enabled: !!memberId && medName.trim().length > 0,
    staleTime: 60_000,
  })
