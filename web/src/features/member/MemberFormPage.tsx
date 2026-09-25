import { useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useId, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import * as api from '../../api/endpoints'
import { invalidateAfterWrite, keys, useMember } from '../../api/hooks'
import type { BloodType, Gender, Member, MemberCreate, MemberPatch, MemberRelation } from '../../api/types'
import { CameraIcon } from '../../components/icons'
import { ConfirmDialog, Sheet } from '../../components/Sheet'
import { toast, toastError } from '../../lib/toast'
import { BottomBar, Button, Chip, ErrorState, FieldError, PageHeader, Segmented, Spinner, TextArea, TextInput } from '../../components/ui'
import { cx } from '../../lib/cx'
import { uuidv7 } from '../../lib/id'
import { compressImage } from '../../lib/image/compress'
import { BLOOD_LABEL, BLOOD_TYPES, RELATION_LABEL, RELATIONS } from '../../lib/labels'
import { formatAge, formatDateFull } from '../../lib/time/format'

export function MemberFormPage() {
  const { id } = useParams()
  const member = useMember(id)
  if (id && member.isPending) return <Spinner />
  if (id && member.isError) return <ErrorState error={member.error} onRetry={() => void member.refetch()} />
  return <MemberForm member={id ? member.data : undefined} />
}

type FormState = {
  nickname: string
  relation: MemberRelation | null
  gender: Gender
  birthDate: string
  avatarId: string | null
  avatarUrl: string | null
  allergies: string
  bloodType: BloodType | null
  notes: string
}

function MemberForm({ member }: { member?: Member }) {
  const id = useId()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [f, setF] = useState<FormState>(() => ({
    nickname: member?.nickname ?? '',
    relation: member?.relation ?? null,
    gender: member?.gender ?? 'male',
    birthDate: member?.birthDate ?? '',
    avatarId: member?.avatarId ?? null,
    avatarUrl: member?.avatarUrl ?? null,
    allergies: member?.allergies ?? '',
    bloodType: member?.bloodType ?? null,
    notes: member?.notes ?? '',
  }))
  const [errors, setErrors] = useState<{ [k: string]: string }>({})
  const [uploading, setUploading] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const set = (patch: Partial<FormState>) => {
    setF((prev) => ({ ...prev, ...patch }))
    setErrors({})
  }
  const back = member ? `/members/${member.id}` : '/'

  async function pickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const { blob } = await compressImage(file, { maxEdge: 512, square: true })
      const a = await api.uploadAttachment(uuidv7(), { kind: 'avatar', file: blob, fileName: 'avatar.jpg' })
      set({ avatarId: a.id, avatarUrl: a.url })
    } catch (err) {
      toastError(err, '头像上传失败')
    } finally {
      setUploading(false)
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!member) {
        const body: MemberCreate = {
          nickname: f.nickname.trim(),
          relation: f.relation!,
          gender: f.gender,
          birthDate: f.birthDate,
        }
        if (f.avatarId) body.avatarId = f.avatarId
        if (f.allergies.trim()) body.allergies = f.allergies.trim()
        if (f.bloodType) body.bloodType = f.bloodType
        if (f.notes.trim()) body.notes = f.notes.trim()
        return api.createMember(body)
      }
      const p: MemberPatch = {}
      if (f.nickname.trim() !== member.nickname) p.nickname = f.nickname.trim()
      if (f.relation !== member.relation) p.relation = f.relation!
      if (f.gender !== member.gender) p.gender = f.gender
      if (f.birthDate !== member.birthDate) p.birthDate = f.birthDate
      if (f.avatarId !== member.avatarId) p.avatarId = f.avatarId
      if ((f.allergies.trim() || null) !== member.allergies) p.allergies = f.allergies.trim() || null
      if (f.bloodType !== member.bloodType) p.bloodType = f.bloodType
      if ((f.notes.trim() || null) !== member.notes) p.notes = f.notes.trim() || null
      return Object.keys(p).length ? api.updateMember(member.id, p) : member
    },
    onSuccess: (saved) => {
      qc.setQueryData(keys.member(saved.id), saved)
      invalidateAfterWrite(qc)
      toast(member ? '已保存' : `已添加${saved.nickname}`)
      navigate(member ? `/members/${saved.id}` : '/', { replace: true })
    },
    onError: (err) => toastError(err),
  })

  const archive = useMutation({
    mutationFn: () => api.archiveMember(member!.id, !member!.archived),
    onSuccess: (saved) => {
      qc.setQueryData(keys.member(saved.id), saved)
      invalidateAfterWrite(qc)
      toast(saved.archived ? '已归档，不再出现在首页' : '已取消归档')
      setConfirmArchive(false)
      navigate(saved.archived ? '/' : `/members/${saved.id}`, { replace: true })
    },
    onError: (err) => toastError(err),
  })

  function submit() {
    const e: { [k: string]: string } = {}
    if (!f.nickname.trim()) e.nickname = '请填写称呼'
    if (!f.relation) e.relation = '请选择关系'
    if (!f.birthDate) e.birthDate = '请选择出生日期'
    else if (dayjs(f.birthDate).isAfter(dayjs())) e.birthDate = '出生日期不能晚于今天'
    setErrors(e)
    if (!Object.keys(e).length) save.mutate()
  }

  return (
    <div className="flex min-h-dvh flex-col lg:min-h-0 lg:max-w-xl">
      <PageHeader
        title={member ? '编辑成员' : '添加成员'}
        left={
          <Link to={back} className="flex h-11 items-center px-3 text-base text-ink-muted">
            取消
          </Link>
        }
      />
      <main className="flex flex-col gap-3.5 px-4 pt-1 pb-4 lg:px-0">
        <div className="flex flex-col items-center gap-2 pt-1.5 pb-1">
          <button
            type="button"
            aria-label={f.avatarUrl ? '更换头像' : '添加头像'}
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className={cx(
              'flex size-20 items-center justify-center overflow-hidden rounded-full bg-surface text-ink-muted',
              !f.avatarUrl && 'border-[1.5px] border-dashed border-ink-subtle',
              uploading && 'animate-pulse',
            )}
          >
            {f.avatarUrl ? <img src={f.avatarUrl} alt="" className="size-full object-cover" /> : <CameraIcon size={28} />}
          </button>
          <span className="text-[13px] text-ink-muted">{uploading ? '正在上传…' : f.avatarUrl ? '点击更换头像' : '头像（选填）'}</span>
          {f.avatarUrl && (
            <button type="button" onClick={() => set({ avatarId: null, avatarUrl: null })} className="h-8 text-[13px] text-primary">
              移除头像
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={pickAvatar} />
        </div>

        <section aria-label="基本信息" className="flex flex-col gap-4 rounded-card bg-surface p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-name`} className="text-[13px] text-ink-muted">
              称呼
            </label>
            <TextInput
              id={`${id}-name`}
              value={f.nickname}
              maxLength={20}
              placeholder="如 小明、爸爸"
              onChange={(e) => set({ nickname: e.target.value })}
              aria-invalid={!!errors.nickname}
            />
            <FieldError>{errors.nickname}</FieldError>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] text-ink-muted">关系</legend>
            <div className="flex flex-wrap gap-2">
              {RELATIONS.map((r) => (
                <Chip key={r} selected={f.relation === r} onClick={() => set({ relation: r })} className="px-4 text-[15px]">
                  {RELATION_LABEL[r]}
                </Chip>
              ))}
            </div>
            <FieldError>{errors.relation}</FieldError>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] text-ink-muted">性别</legend>
            <Segmented<Gender>
              label="性别"
              value={f.gender}
              onChange={(gender) => set({ gender })}
              options={[
                { value: 'male', label: '男' },
                { value: 'female', label: '女' },
              ]}
            />
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-birth`} className="text-[13px] text-ink-muted">
              出生日期
            </label>
            <TextInput
              id={`${id}-birth`}
              type="date"
              max={dayjs().format('YYYY-MM-DD')}
              value={f.birthDate}
              onChange={(e) => set({ birthDate: e.target.value })}
              aria-invalid={!!errors.birthDate}
            />
            <span className="text-xs text-ink-muted">
              {f.birthDate && dayjs(f.birthDate).isValid() && !dayjs(f.birthDate).isAfter(dayjs())
                ? `${formatDateFull(f.birthDate)}，${formatAge(f.birthDate)}。报告里会显示当时的年龄`
                : '用来计算年龄，报告里会显示当时的年龄'}
            </span>
            <FieldError>{errors.birthDate}</FieldError>
          </div>
        </section>

        <section aria-label="健康信息" className="flex flex-col gap-4 rounded-card bg-surface p-4">
          <h2 className="text-[15px] font-bold">
            健康信息<span className="text-[13px] font-normal text-ink-muted">（都可以以后再补）</span>
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-allergy`} className="text-[13px] text-ink-muted">
              过敏史
            </label>
            <TextArea
              id={`${id}-allergy`}
              rows={2}
              maxLength={500}
              placeholder="如青霉素、花粉；没有可以不填"
              value={f.allergies}
              onChange={(e) => set({ allergies: e.target.value })}
              className="h-[68px]"
            />
            <span className="text-xs text-ink-muted">会显示在成员卡片和报告首页</span>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] text-ink-muted">血型</legend>
            <div className="flex gap-2">
              {BLOOD_TYPES.map((b) => (
                <Chip
                  key={b}
                  selected={f.bloodType === b}
                  onClick={() => set({ bloodType: f.bloodType === b ? null : b })}
                  className="flex-1 px-0 text-[15px]"
                >
                  {BLOOD_LABEL[b]}
                </Chip>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-memo`} className="text-[13px] text-ink-muted">
              备注
            </label>
            <TextInput
              id={`${id}-memo`}
              maxLength={1000}
              placeholder="其他需要医生知道的信息"
              value={f.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </section>

        {member && (
          <section aria-label="管理" className="flex flex-col gap-2 rounded-card bg-surface p-4">
            <Button block onClick={() => setConfirmArchive(true)}>
              {member.archived ? '取消归档' : '归档这位成员'}
            </Button>
            <p className="text-xs leading-relaxed text-ink-muted">归档后数据都保留，只是不再出现在首页和“给谁记”里。</p>
            <Button block variant="danger" onClick={() => setDeleteOpen(true)} className="mt-2">
              删除成员
            </Button>
          </section>
        )}
      </main>

      <BottomBar className="border-t-0">
        <Button block size="lg" variant="dark" disabled={save.isPending || uploading} onClick={submit}>
          {save.isPending ? '保存中…' : '保存成员'}
        </Button>
      </BottomBar>

      {member && (
        <>
          <ConfirmDialog
            open={confirmArchive}
            title={member.archived ? `取消归档${member.nickname}？` : `归档${member.nickname}？`}
            message={member.archived ? '取消后会重新出现在首页。' : '数据会保留，之后可以在成员页取消归档。'}
            busy={archive.isPending}
            onConfirm={() => archive.mutate()}
            onClose={() => setConfirmArchive(false)}
          />
          {deleteOpen && <DeleteMemberSheet member={member} onClose={() => setDeleteOpen(false)} />}
        </>
      )}
    </div>
  )
}

/** Deleting removes every record and file, so the name has to be typed in to confirm. */
function DeleteMemberSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const id = useId()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const del = useMutation({
    mutationFn: () => api.deleteMember(member.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.member(member.id) })
      invalidateAfterWrite(qc)
      toast(`已删除${member.nickname}的全部数据`)
      navigate('/', { replace: true })
    },
    onError: (err) => toastError(err),
  })
  return (
    <Sheet
      open
      onClose={onClose}
      title={`删除${member.nickname}？`}
      footer={
        <Button
          block
          size="lg"
          variant="dark"
          className="bg-alert"
          disabled={typed.trim() !== member.nickname || del.isPending}
          onClick={() => del.mutate()}
        >
          {del.isPending ? '删除中…' : '永久删除'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
        <p className="text-alert">{member.nickname}的全部病程、记录、照片和语音都会删除，不能恢复。只是不想在首页看到，可以用“归档”。</p>
        <label htmlFor={`${id}-c`} className="text-[13px] text-ink-muted">
          输入“{member.nickname}”确认删除
        </label>
        <TextInput id={`${id}-c`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </div>
    </Sheet>
  )
}
