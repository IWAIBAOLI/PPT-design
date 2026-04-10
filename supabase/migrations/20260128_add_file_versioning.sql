-- Add version column to generated_files table
ALTER TABLE public.generated_files 
ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Add is_current column to easily query the latest version
ALTER TABLE public.generated_files 
ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT true;

-- Create an index to speed up querying the latest version
CREATE INDEX IF NOT EXISTS idx_generated_files_project_name_version 
ON public.generated_files(project_id, file_name, version DESC);

-- Update existing records to be version 1 and current (already defaults, but being explicit)
UPDATE public.generated_files SET version = 1, is_current = true WHERE version IS NULL;
