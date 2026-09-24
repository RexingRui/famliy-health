import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <section className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <h1 className="font-display text-3xl">页面不存在</h1>
      <Link to="/" className="text-primary">
        回到首页
      </Link>
    </section>
  )
}
