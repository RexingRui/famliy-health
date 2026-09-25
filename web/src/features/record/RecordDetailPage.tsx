import { PagePlaceholder } from '../../components/PagePlaceholder'

export function RecordDetailPage() {
  return (
    <PagePlaceholder
      title="记录详情"
      summary="查看一条记录（发生 / 录入时间、所属病程、类型、程度、附件），可删除、移到其他病程；编辑时可改成员、时间、文字、类型，补录语音、增删照片。编辑表单复用记一笔。"
      design="记录详情、编辑记录（补录语音）"
    />
  )
}
