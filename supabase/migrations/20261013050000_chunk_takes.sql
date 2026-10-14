-- Prises refaites d'un passage : hash d'origine du chunk → numéro de la prise en cours.
-- Les chunks sont un état dérivé, recalculé à chaque passage : la prise choisie doit vivre
-- ailleurs. Colonne interne, non lisible depuis le navigateur (droits par colonne de `courses`).
alter table courses add column chunk_takes jsonb not null default '{}'::jsonb;
