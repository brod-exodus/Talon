-- Team profile photo support for Talon account menus.
-- Apply before enabling profile photo uploads in production.

ALTER TABLE public.team_memberships
  ADD COLUMN IF NOT EXISTS display_name TEXT CHECK (display_name IS NULL OR char_length(display_name) <= 120),
  ADD COLUMN IF NOT EXISTS avatar_url TEXT CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2048),
  ADD COLUMN IF NOT EXISTS avatar_path TEXT CHECK (avatar_path IS NULL OR char_length(avatar_path) <= 512),
  ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-avatars',
  'team-avatars',
  TRUE,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'team_avatars_public_read'
  ) THEN
    CREATE POLICY "team_avatars_public_read"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'team-avatars');
  END IF;
END $$;
