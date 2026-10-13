-- Heure de soumission du job Batch TTS : au-delà de 24 h, le cours bascule en Express (§8.5).
alter table courses add column batch_submitted_at timestamptz;
