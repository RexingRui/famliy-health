import { useIsDesktop } from '../../app/useIsDesktop'
import { PagePlaceholder } from '../../components/PagePlaceholder'

/** `/` is 首页 on mobile and 家庭总览 on desktop. */
export function HomePage() {
  return useIsDesktop() ? (
    <PagePlaceholder
      title="家庭总览"
      summary="每个成员一栏：当前状态、未结束的病程、最近记录。顶部有文字搜索。"
      design="电脑端：家庭总览"
    />
  ) : (
    <PagePlaceholder
      title="家里的病程"
      summary="成员头像快速切换、“记一笔”大按钮、未结束的病程卡片、待整理数量、待上传提示。"
      design="首页"
    />
  )
}
