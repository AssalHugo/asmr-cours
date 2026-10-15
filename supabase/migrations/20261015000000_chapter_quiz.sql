-- Quiz audio en fin de chapitre : 2 ou 3 questions murmurées, un silence pour répondre dans
-- sa tête, puis la réponse. Choisi au lancement du cours ; les cours existants n'en ont pas.
alter table courses add column quiz boolean not null default false;
grant select (quiz) on courses to authenticated;

-- Questions et réponses de la section, écrites d'après sa source après la réécriture.
alter table sections add column quiz jsonb;

-- Nature du passage : texte du cours, ou question, réponse et transitions du quiz.
alter table chunks add column kind text not null default 'speech' check (kind in ('speech', 'quiz'));
