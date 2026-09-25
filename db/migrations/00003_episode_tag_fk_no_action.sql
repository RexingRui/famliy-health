-- +goose Up
-- RESTRICT is checked immediately, so deleting a family (which cascades to both its episodes
-- and its custom disease tags) could fail mid-cascade. NO ACTION is checked at statement end.
ALTER TABLE episodes DROP CONSTRAINT episodes_disease_tag_id_fkey;
ALTER TABLE episodes ADD CONSTRAINT episodes_disease_tag_id_fkey
    FOREIGN KEY (disease_tag_id) REFERENCES disease_tags (id);

-- +goose Down
ALTER TABLE episodes DROP CONSTRAINT episodes_disease_tag_id_fkey;
ALTER TABLE episodes ADD CONSTRAINT episodes_disease_tag_id_fkey
    FOREIGN KEY (disease_tag_id) REFERENCES disease_tags (id) ON DELETE RESTRICT;
