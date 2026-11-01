-- Owner-transcribed window labels: the human-readable program-group
-- text ("All winter swimming activities") that used to sit in scope.
-- Scope now always names a listing source; matching reads the label.
alter table public.registration_windows add column label text;
