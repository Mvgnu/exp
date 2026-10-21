ALTER TABLE deeplake_jobs DROP CONSTRAINT deeplake_jobs_kind_check;
ALTER TABLE deeplake_jobs ADD CONSTRAINT deeplake_jobs_kind_check CHECK (kind IN ('cycle','ingest','replay','reparse','maintenance','publish'));
