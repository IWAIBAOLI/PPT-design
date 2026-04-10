-- 创建projects表
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id UUID,
    project_name TEXT NOT NULL,
    user_prompt TEXT,
    brief_json JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'completed', 'error')),
    model_used TEXT
);

-- 创建pipeline_results表
CREATE TABLE IF NOT EXISTS public.pipeline_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    step_name TEXT NOT NULL CHECK (step_name IN ('dna', 'assets', 'layout', 'metrics', 'assembly', 'qc')),
    status TEXT NOT NULL CHECK (status IN ('success', 'error', 'running')),
    message TEXT,
    output JSONB,
    from_log BOOLEAN DEFAULT false
);

-- 创建generated_files表
CREATE TABLE IF NOT EXISTS public.generated_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    file_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON public.projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_results_project_id ON public.pipeline_results(project_id);
CREATE INDEX IF NOT EXISTS idx_generated_files_project_id ON public.generated_files(project_id);

-- 启用RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_files ENABLE ROW LEVEL SECURITY;

-- 创建RLS策略（暂时允许所有操作，因为未启用用户认证）
CREATE POLICY "Enable all for projects" ON public.projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for pipeline_results" ON public.pipeline_results FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for generated_files" ON public.generated_files FOR ALL USING (true) WITH CHECK (true);

-- 创建updated_at自动更新触发器
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- 创建Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('ppt-files', 'ppt-files', false)
ON CONFLICT (id) DO NOTHING;

-- 为Storage bucket创建RLS策略
CREATE POLICY "Enable all for ppt-files" ON storage.objects FOR ALL USING (bucket_id = 'ppt-files') WITH CHECK (bucket_id = 'ppt-files');
