-- +goose Up
-- Initial preset list (extend with a new migration; custom tags are per family).
INSERT INTO disease_tags (id, family_id, name)
SELECT gen_random_uuid(), NULL, name
FROM unnest(ARRAY[
    '感冒', '发烧', '咳嗽', '肠胃炎', '腹泻', '流感', '支原体肺炎', '支气管炎', '手足口病', '中耳炎',
    '湿疹', '哮喘', '过敏性鼻炎', '高血压', '糖尿病', '腰椎间盘突出', '颈椎病'
]) AS name
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM disease_tags WHERE family_id IS NULL;
