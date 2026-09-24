import { PagePlaceholder } from '../../components/PagePlaceholder'

export function PrintEpisodePage() {
  return (
    <PagePlaceholder
      title="病程报告"
      summary="打印专用页，无外壳。供 Gotenberg 渲染 PDF、导出页 iframe 预览和浏览器打印共用；渲染完成后设置 window.__PRINT_READY__。"
    />
  )
}
