-- Games are played through itch.io now.
--
-- Two addresses are stored, both canonicalised by the Worker before writing:
--   itch_url        https://<creator>.itch.io/<game>   (the public page)
--   itch_embed_url  https://itch.io/embed-upload/<id>   (the playable iframe)
--
-- The numeric embed id belongs to the uploaded HTML5 file, not to the project,
-- so it cannot be derived from itch_url and is stored separately. Cover art and
-- screenshots stay exactly where they were: in the FILES bucket, referenced by
-- the thumbnail_key/banner_key/screenshots columns above.
ALTER TABLE games ADD COLUMN itch_url TEXT;
ALTER TABLE games ADD COLUMN itch_embed_url TEXT;

CREATE INDEX IF NOT EXISTS idx_games_itch ON games(itch_url);
