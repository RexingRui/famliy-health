-- +goose Up
-- No more preset tags: every tag belongs to a family and is created on first use.
-- Presets already used by an episode become tags of that family.
INSERT INTO disease_tags (id, family_id, name)
SELECT DISTINCT ON (e.family_id, t.name) gen_random_uuid(), e.family_id, t.name
FROM episodes e
JOIN disease_tags t ON t.id = e.disease_tag_id
WHERE t.family_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE episodes e SET disease_tag_id = f.id
FROM disease_tags p, disease_tags f
WHERE e.disease_tag_id = p.id AND p.family_id IS NULL
  AND f.family_id = e.family_id AND f.name = p.name;

DELETE FROM disease_tags WHERE family_id IS NULL;
ALTER TABLE disease_tags ALTER COLUMN family_id SET NOT NULL;

-- +goose Down
ALTER TABLE disease_tags ALTER COLUMN family_id DROP NOT NULL;
