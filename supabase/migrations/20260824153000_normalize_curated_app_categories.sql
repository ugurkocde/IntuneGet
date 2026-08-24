-- Normalize curated_apps.category to lowercase slug form.
--
-- The catalog accumulated mixed-case category values ("Business" next to
-- "business", counts of 1 to 4 per stray variant), which duplicated category
-- listings and split hub pages until the UI started merging them case
-- insensitively. Normalize the stored values to the canonical slug form
-- (lowercase, whitespace collapsed to hyphens) so every consumer sees one
-- value per category. The UI keeps its case-insensitive merge as a guard for
-- future strays.

update curated_apps
set category = regexp_replace(lower(btrim(category)), '\s+', '-', 'g')
where category is not null
  and category <> regexp_replace(lower(btrim(category)), '\s+', '-', 'g');
