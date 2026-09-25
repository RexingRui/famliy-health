import { PagePlaceholder } from '../../components/PagePlaceholder'

export function LoginPage() {
  return (
    <PagePlaceholder
      title="登录"
      summary="账号密码登录，可切换显示密码；“30 天内保持登录”默认勾选（取消则关闭浏览器即退出）。账号由命令行创建，不开放注册。手机和电脑两种布局。"
      design="登录（手机）、登录（电脑）"
    />
  )
}
