
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ROOT_DIR = path.resolve(__dirname, '../../');
require('dotenv').config({ path: path.resolve(ROOT_DIR, 'frontend/.env.local') });

const WORK_DIR = path.join(ROOT_DIR, 'pipeline_work');
const ARCHIVE_DIR = path.join(ROOT_DIR, 'generated_projects');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase Env Vars (need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrate() {
    // 1. Get Latest Project
    const { data: projects, error } = await supabase
        .from('projects')
        .select('id, project_name, created_at')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error || !projects || projects.length === 0) {
        console.error("Could not find latest project.", error);
        return;
    }

    const project = projects[0];
    const projectId = project.id;
    console.log(`Target Project: ${project.project_name} (${projectId})`);

    const projectDir = path.join(ARCHIVE_DIR, projectId);

    // Helper to move file
    async function moveFile(srcPath, stepName, destName, fileType) {
        if (!fs.existsSync(srcPath)) {
            console.log(`[Skip] Missing ${srcPath}`);
            return;
        }

        const destDir = path.join(projectDir, stepName);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        const destPath = path.join(destDir, destName);
        fs.copyFileSync(srcPath, destPath);
        console.log(`[Copy] ${destName} -> ${stepName}/`);

        // Database Update (Generated Files)
        // We use a logical path 'projectId/filename' compatible with our schema
        const storagePath = `${projectId}/${destName}`;

        // Check if exists
        const { data: existing } = await supabase
            .from('generated_files')
            .select('id')
            .eq('project_id', projectId)
            .eq('file_name', destName)
            .single();

        if (!existing) {
            const stats = fs.statSync(srcPath);
            await supabase.from('generated_files').insert({
                project_id: projectId,
                file_type: fileType,
                file_name: destName,
                storage_path: storagePath,
                file_size: stats.size
            });
            console.log(`[DB] Inserted generated_files record for ${destName}`);
        }
    }

    // 2. Migrate DNA
    await moveFile(path.join(WORK_DIR, 'theme.css'), 'dna', 'theme.css', 'theme_css');

    // 3. Migrate Assets
    await moveFile(path.join(WORK_DIR, 'components.html'), 'assets', 'components.html', 'html_assets');
    await moveFile(path.join(WORK_DIR, 'components_preview.html'), 'assets', 'components_preview.html', 'html_assets');

    // 4. Migrate Layouts
    const htmlDir = path.join(WORK_DIR, '1_html_slides');
    if (fs.existsSync(htmlDir)) {
        const files = fs.readdirSync(htmlDir).filter(f => f.endsWith('.html'));
        for (const f of files) {
            await moveFile(path.join(htmlDir, f), 'layout', f, 'html_slide');
        }
    }

    // 5. Migrate Assembly
    await moveFile(path.join(WORK_DIR, '3_pptx/output.pptx'), 'assembly', 'output.pptx', 'pptx');

    console.log("Migration Complete.");
}

migrate();
