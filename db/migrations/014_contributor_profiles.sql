-- Lightweight contributor profile fields for recruiter notes and reminders.

ALTER TABLE public.contributors
  ADD COLUMN IF NOT EXISTS outreach_notes_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_note TEXT,
  ADD COLUMN IF NOT EXISTS reminder_date DATE,
  ADD COLUMN IF NOT EXISTS reminder_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contributors_team_reminder_date
  ON public.contributors(team_id, reminder_date)
  WHERE reminder_date IS NOT NULL;
