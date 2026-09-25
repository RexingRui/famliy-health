import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { login } from '../../api/endpoints'
import { keys, useMe } from '../../api/hooks'
import { useIsDesktop } from '../../app/useIsDesktop'
import { CalendarIcon, DocIcon, EyeIcon, EyeOffIcon, MicIcon } from '../../components/icons'
import { Spinner } from '../../components/ui'
import { cx } from '../../lib/cx'

/** Only same-app paths are allowed as the post-login destination. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export function LoginPage() {
  const isDesktop = useIsDesktop()
  const me = useMe()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  if (me.isPending) return <Spinner />
  if (me.data) return <Navigate to={next} replace />

  return isDesktop ? (
    <div className="flex min-h-dvh">
      <section
        aria-label="产品介绍"
        className="flex w-[640px] shrink-0 flex-col justify-between bg-primary p-16 text-white max-xl:w-[46%]"
      >
        <div className="flex items-center gap-3.5">
          <span className="flex size-12 items-center justify-center rounded-[14px] bg-white font-display text-2xl text-primary">家</span>
          <span className="font-display text-[28px]">家庭病程</span>
        </div>
        <div className="flex flex-col gap-9">
          <h2 className="max-w-[460px] font-display text-[52px] leading-[1.3] font-normal">记下家人每一次生病和康复</h2>
          <ul className="flex flex-col gap-[18px] text-[17px]">
            {[
              { icon: MicIcon, text: '手机上随手记：语音、照片、文字' },
              { icon: CalendarIcon, text: '电脑上汇总看：时间线、日历、按病种' },
              { icon: DocIcon, text: '一键导出 PDF，看病时拿给医生' },
            ].map(({ icon: I, text }) => (
              <li key={text} className="flex items-center gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-white/15">
                  <I size={20} strokeWidth={2} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-primary-soft">仅供家庭记录，不提供医疗建议</p>
      </section>
      <main className="flex flex-1 items-center justify-center">
        <section aria-label="登录" className="flex w-[420px] flex-col gap-5 rounded-[24px] bg-surface p-10">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display text-[34px] leading-tight font-normal">登录</h1>
            <p className="text-sm text-ink-muted">使用后台创建的账号登录</p>
          </div>
          <LoginForm next={next} dense />
          <p className="text-center text-[13px] text-ink-muted">账号在后台创建，暂不开放注册</p>
        </section>
      </main>
    </div>
  ) : (
    <div className="flex min-h-dvh flex-col">
      <div className="flex flex-1 flex-col justify-center gap-3.5 px-8 py-10">
        <span className="flex size-[60px] items-center justify-center rounded-[18px] bg-primary font-display text-[30px] text-white">家</span>
        <h1 className="font-display text-[42px] leading-[1.15] font-normal">家庭病程</h1>
        <p className="text-base leading-relaxed text-ink-muted">记下家人每一次生病和康复</p>
      </div>
      <section aria-label="登录" className="mx-4 flex flex-col gap-4 rounded-[24px] bg-surface px-5 py-6">
        <LoginForm next={next} />
      </section>
      <p className="px-8 pt-4 pb-9 text-center text-[13px] text-ink-muted">账号在后台创建，暂不开放注册</p>
    </div>
  )
}

function LoginForm({ next, dense }: { next: string; dense?: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [missing, setMissing] = useState(false)
  const mutation = useMutation({
    mutationFn: () => login(username.trim(), password, remember),
    onSuccess: (me) => {
      qc.clear()
      qc.setQueryData(keys.me, me)
      navigate(next, { replace: true })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const incomplete = !username.trim() || !password
    setMissing(incomplete)
    if (!incomplete) mutation.mutate()
  }

  const field = cx(
    'box-border rounded-control border border-line bg-field text-ink',
    dense ? 'h-12 text-[15px]' : 'h-[50px] text-base',
  )

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="account" className="text-[13px] text-ink-muted">
          账号
        </label>
        <input
          id="account"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          placeholder="请输入账号"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={cx(field, 'px-3.5 placeholder:text-ink-subtle focus:border-primary focus:outline-none')}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-[13px] text-ink-muted">
          密码
        </label>
        <div className={cx(field, 'flex items-center pr-1 pl-3.5 focus-within:border-primary')}>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="请输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-subtle"
          />
          <button
            type="button"
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            className="flex size-11 items-center justify-center text-ink-muted"
          >
            {showPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
          </button>
        </div>
      </div>
      <label className="flex h-9 items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="size-[18px] accent-primary"
        />
        30 天内保持登录
      </label>
      {(missing || mutation.error) && (
        <p role="alert" className="-mt-1 text-sm text-alert">
          {missing ? '请输入账号和密码' : mutation.error?.message}
        </p>
      )}
      <button
        type="submit"
        disabled={mutation.isPending}
        className={cx(
          'flex items-center justify-center bg-primary font-bold text-white disabled:opacity-60',
          dense ? 'h-[50px] rounded-control text-base' : 'h-[52px] rounded-[14px] text-[17px]',
        )}
      >
        {mutation.isPending ? '登录中…' : '登录'}
      </button>
    </form>
  )
}
