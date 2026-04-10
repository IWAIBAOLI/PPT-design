import { NextResponse } from 'next/server';
import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import { createClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';

const execPromise = util.promisify(exec);

// --- Configuration ---
const ROOT_DIR = path.resolve(process.cwd(), '..');
const SKILLS_DIR = path.join(ROOT_DIR, 'my_skills');

const DNA_SCRIPT = path.join(SKILLS_DIR, 'define_visual_dna', 'scripts', 'generate_dna.py');
const BUILDER_SCRIPT = path.join(SKILLS_DIR, 'architect_html_layouts', 'scripts', 'build_slides.py');
const LINT_SCRIPT = path.join(SKILLS_DIR, 'assemble_pptx_file', 'scripts', 'lint_ppt_html.py');
const AUTO_FIX_SCRIPT = path.join(SKILLS_DIR, 'assemble_pptx_file', 'scripts', 'auto_fix_html.py');
const ASSEMBLER_SCRIPT = path.join(SKILLS_DIR, 'assemble_pptx_file', 'scripts', 'batch_convert.js');
const QC_SCRIPT = path.join(SKILLS_DIR, 'inspect_pptx_quality', 'scripts', 'qc_inspector.py');

const ASSEMBLER_VENV = path.join(ROOT_DIR, 'venv', 'bin', 'python3');

// --- Legacy / Default Paths (Fallbacks) ---
const WORK_DIR = path.join(ROOT_DIR, 'pipeline_work');
const BRIEF_PATH = path.join(ROOT_DIR, 'pipeline_input', 'full_brief.json');
const DRAFT_PATH = path.join(ROOT_DIR, 'pipeline_input', 'content_draft.json');
const HTML_DIR = path.join(WORK_DIR, '1_html_slides');
const PPTX_DIR = path.join(WORK_DIR, '3_pptx');
const FINAL_OUTPUT = path.join(PPTX_DIR, 'output.pptx');

// Helper to manually read .env.local because process.env is only loaded on startup
async function loadEnvLocal() {
    try {
        const envPath = path.join(process.cwd(), '.env.local');
        const content = await fs.readFile(envPath, 'utf-8');
        const env: Record<string, string> = {};
        content.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value = match[2].trim();
                // Remove quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                if (key && !key.startsWith('#')) {
                    env[key] = value;
                }
            }
        });
        return env;
    } catch (e) {
        console.warn("[API] Could not read .env.local");
        return {};
    }
}

// Custom LLM Config (Initialized in Handler to support dynamic reloading)
const getBaseEnv = async () => {
    const localEnv = await loadEnvLocal();
    return {
        ...process.env,
        ...localEnv, // Override process.env with current file content
        // Fallback Priority: Env > LocalEnv > Hardcoded Local Proxy Key
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || localEnv.ANTHROPIC_API_KEY || localEnv.OPENAI_API_KEY || 'Gemini-API-maxuning',
        OPENAI_BASE_URL: 'http://127.0.0.1:8317/v1',
        // Ensure Pixabay Key is present
        PIXABAY_API_KEY: process.env.PIXABAY_API_KEY || localEnv.PIXABAY_API_KEY
    };
};

// --- Helper: Local Archiver & DB Syncer ---
async function archiveFile(projectId: string, stepName: string, sourcePath: string, fileName: string, supabase: SupabaseClient, explicitFileType?: string, minTimestamp?: number) {
    if (!projectId) return;

    const projectDir = path.join(ROOT_DIR, 'generated_projects', projectId);
    const stepDir = path.join(projectDir, stepName);
    const destPath = path.join(stepDir, fileName);

    // Check if source file exists
    let stats;
    try {
        stats = await fs.stat(sourcePath);
    } catch (e) {
        console.warn(`[API] Source file not found for archiving: ${sourcePath}`);
        return null;
    }

    // Time-based filtering: If file was not modified after minTimestamp, skip it.
    if (minTimestamp && stats.mtimeMs < minTimestamp) {
        // console.log(`[API] Skipping ${fileName} (Not modified: ${stats.mtimeMs} < ${minTimestamp})`);
        return null;
    }

    await fs.mkdir(stepDir, { recursive: true });

    if (stats.isDirectory()) {
        await fs.cp(sourcePath, destPath, { recursive: true });
        console.log(`[API] Archived directory ${fileName} to ${stepDir}`);
        return destPath; // Directories are not synced to DB individually
    } else {
        await fs.copyFile(sourcePath, destPath);
        console.log(`[API] Archived file ${fileName} to ${stepDir}`);
    }

    // Sync to 'generated_files' table (Files only)
    if (supabase) {
        try {
            let fileType = explicitFileType || 'other';

            if (!explicitFileType) {
                if (stepName === 'dna') fileType = 'theme_css';
                else if (stepName === 'assets') fileType = 'html_assets';
                else if (stepName === 'layout' && fileName.endsWith('.html')) fileType = 'html_slide';
                else if (stepName === 'assembly' && fileName.endsWith('.pptx')) fileType = 'pptx_output';
            }

            // Versioning Logic
            // 1. Get max version for this project and file_name
            const { data: existingFiles, error: fetchError } = await supabase
                .from('generated_files')
                .select('version')
                .eq('project_id', projectId)
                .eq('file_name', fileName)
                .order('version', { ascending: false })
                .limit(1);

            let newVersion = 1;
            if (existingFiles && existingFiles.length > 0) {
                newVersion = (existingFiles[0].version || 1) + 1;
            }

            // 2. Set previous versions to is_current = false
            await supabase
                .from('generated_files')
                .update({ is_current: false })
                .eq('project_id', projectId)
                .eq('file_name', fileName);

            // 3. Insert new record
            const { error } = await supabase.from('generated_files').insert({
                project_id: projectId,
                file_type: fileType,
                file_name: fileName,
                storage_path: path.relative(path.join(ROOT_DIR, 'generated_projects'), destPath), // efficient relative path
                file_size: stats.size,
                version: newVersion,
                is_current: true
            });

            if (error) console.error(`[API] Failed to sync ${fileName} to generated_files:`, error.message);
            else console.log(`[API] Synced ${fileName} (v${newVersion}) to DB generated_files.`);

        } catch (e: any) {
            console.error(`[API] DB Sync Error for ${fileName}:`, e.message);
        }
    }

    return destPath;
}

// --- Helper: Sync Artifacts (Extracted for reusability) ---
async function syncArtifacts(step: string, projectId: string, projectWorkDir: string, projectHtmlDir: string, projectFinalOutput: string, supabase: SupabaseClient, startTime: number) {
    console.log(`[API] Starting DB Sync for step: ${step} (Modified since ${startTime})`);
    let output: any = {};

    try {
        if (step === 'dna') {
            const themePath = path.join(projectWorkDir, 'theme.css');
            if ((await fs.stat(themePath).catch(() => false))) {
                const stats = await fs.stat(themePath);
                await archiveFile(projectId, 'dna', themePath, 'theme.css', supabase, undefined, startTime);
                output = { size: stats.size };
            }
        }
        else if (step === 'assets') {
            const componentsPath = path.join(projectWorkDir, 'components.html');
            const previewPath = path.join(projectWorkDir, 'components_preview.html');
            if ((await fs.stat(componentsPath).catch(() => false))) await archiveFile(projectId, 'assets', componentsPath, 'components.html', supabase, undefined, startTime);
            if ((await fs.stat(previewPath).catch(() => false))) await archiveFile(projectId, 'assets', previewPath, 'components_preview.html', supabase, undefined, startTime);
            output = { generated: true };
        }
        else if (step === 'layout') {
            // Archive all HTMLs
            if ((await fs.stat(projectHtmlDir).catch(() => false))) {
                const files = await fs.readdir(projectHtmlDir);
                const htmlFiles = files.filter(f => f.endsWith('.html'));
                for (const f of htmlFiles) await archiveFile(projectId, 'layout', path.join(projectHtmlDir, f), f, supabase, undefined, startTime);
                // Archive Images
                const imagesPath = path.join(projectHtmlDir, 'images');
                if ((await fs.stat(imagesPath).catch(() => false))) await archiveFile(projectId, 'layout', imagesPath, 'images', supabase, undefined, startTime);

                output = { count: htmlFiles.length, files: htmlFiles };
            }
        }
        else if (step === 'assembly') {
            if ((await fs.stat(projectFinalOutput).catch(() => false))) {
                const stats = await fs.stat(projectFinalOutput);
                await archiveFile(projectId, 'assembly', projectFinalOutput, 'output.pptx', supabase, undefined, startTime);
                output = { size: stats.size };
            }
        }
        else if (step === 'qc') {
            // QC usually outputs to stdout, captured by stream. Assuming no specific file to archive unless specified.
            // Maybe archive 'qc_report.json' if it exists.
            output = { qc_completed: true };
        }

        // Update pipeline_results
        await supabase.from('pipeline_results').insert({
            project_id: projectId, step_name: step, status: 'success', message: 'Execution success', output
        });
        console.log(`[API] DB Sync completed for step: ${step}`);

    } catch (e: any) {
        console.error(`[API] Error inside syncArtifacts: ${e.message}`);
    }
    return output;
}


// --- Streaming Helper 2.0 ---
async function spawnCommand(commandStr: string, env: NodeJS.ProcessEnv = process.env, onComplete?: () => Promise<void>): Promise<ReadableStream> {
    console.log(`[API] Spawning Command (stream): ${commandStr}`);
    const [cmd, ...args] = commandStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

    const cleanCmd = cmd ? cmd.replace(/(^"|"$)/g, '') : '';
    const cleanArgs = args.map(arg => arg.replace(/(^"|"$)/g, ''));

    return new ReadableStream({
        start(controller) {
            // Use shell: true for complex commands
            const childProcess = spawn(commandStr, { env, shell: true });

            childProcess.stdout.on('data', (chunk) => {
                controller.enqueue(chunk);
            });

            childProcess.stderr.on('data', (chunk) => {
                controller.enqueue(chunk);
            });

            childProcess.on('close', async (code) => {
                if (code !== 0) {
                    controller.enqueue(new TextEncoder().encode(`\n[Process exited with code ${code}]\n`));
                } else {
                    controller.enqueue(new TextEncoder().encode(`\n[Process completed successfully]\n`));
                    // Trigger callback on success
                    if (onComplete) {
                        try {
                            controller.enqueue(new TextEncoder().encode(`\n[Syncing artifacts to database...]\n`));
                            await onComplete();
                            controller.enqueue(new TextEncoder().encode(`\n[Sync completed]\n`));
                        } catch (e: any) {
                            controller.enqueue(new TextEncoder().encode(`\n[Sync failed: ${e.message}]\n`));
                        }
                    }
                }
                controller.close();
            });

            childProcess.on('error', (err) => {
                controller.enqueue(new TextEncoder().encode(`\n[Process Error: ${err.message}]\n`));
                controller.close();
            });
        }
    });
}

// --- Legacy Helper: Buffered Execution ---
async function runCommand(command: string, env: NodeJS.ProcessEnv = process.env) {
    console.log(`[API] Executing Command: ${command}`);
    const startTime = Date.now();
    try {
        const { stdout, stderr } = await execPromise(command, { env });
        const duration = Date.now() - startTime;
        console.log(`[API] Command Completed in ${duration}ms`);

        if (stdout) console.log(`[API] Stdout (first 100 chars): ${stdout.substring(0, 100).replace(/\n/g, ' ')}...`);
        if (stderr && !stderr.includes('Debugger attached')) {
            console.warn(`[API] Stderr: ${stderr}`);
        }
        return stdout;
    } catch (error: any) {
        console.error(`[API] Command Failed: ${command}`, error);
        const output = error.stdout ? `\nOutput:\n${error.stdout}` : '';
        const errOutput = error.stderr ? `\nError Output:\n${error.stderr}` : '';
        throw new Error(`${error.message || String(error)}${output}${errOutput}`);
    }
}


export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { step, fromLog, model, projectId, filterSlides, useStream } = body;
        let output: any = '';

        const supabase = await createClient();

        // Dynamic Env
        const baseEnv = await getBaseEnv();
        const currentEnv: NodeJS.ProcessEnv = {
            ...baseEnv,
            OPENAI_MODEL: model || (baseEnv as any).OPENAI_MODEL
        };

        // --- Dynamic Paths Resolution ---
        let projectWorkDir = WORK_DIR;
        let projectBriefPath = BRIEF_PATH;
        let projectDraftPath = DRAFT_PATH;
        let projectHtmlDir = HTML_DIR;
        let projectPptxDir = PPTX_DIR;
        let projectFinalOutput = FINAL_OUTPUT;

        if (projectId) {
            const projectRoot = path.join(ROOT_DIR, 'generated_projects', projectId);
            const inputDir = path.join(projectRoot, 'input');

            projectWorkDir = path.join(projectRoot, 'work');
            projectBriefPath = path.join(inputDir, 'brief.json');
            projectDraftPath = path.join(inputDir, 'draft.json');

            projectHtmlDir = path.join(projectWorkDir, '1_html_slides');
            projectPptxDir = path.join(projectWorkDir, '3_pptx');
            projectFinalOutput = path.join(projectPptxDir, 'output.pptx');

            await fs.mkdir(inputDir, { recursive: true });
        }

        // Fetch Brief and Draft
        if (projectId) {
            const { data: project } = await supabase
                .from('projects')
                .select('brief_json, content_draft')
                .eq('id', projectId)
                .single();

            if (project) {
                if (project.brief_json) {
                    await fs.writeFile(projectBriefPath, JSON.stringify(project.brief_json, null, 2), 'utf-8');
                }
                if (project.content_draft) {
                    await fs.writeFile(projectDraftPath, JSON.stringify(project.content_draft, null, 2), 'utf-8');
                }
                console.log(`[API] Synced project data for ${projectId}`);
            }
        }

        await fs.mkdir(projectWorkDir, { recursive: true });

        // --- RESTORE WORKSPACE ARTIFACTS ---
        if (projectId) {
            const workThemePath = path.join(projectWorkDir, 'theme.css');
            if (!(await fs.stat(workThemePath).catch(() => false))) {
                // Try to find the latest version from DB or just filesystem archive?
                // Filesystem archive is reliable enough for now.
                const archiveThemePath = path.join(ROOT_DIR, 'generated_projects', projectId, 'dna', 'theme.css');
                if (await fs.stat(archiveThemePath).catch(() => false)) {
                    await fs.copyFile(archiveThemePath, workThemePath);
                    console.log(`[API] Restored theme.css`);
                }
            }

            const workCompPath = path.join(projectWorkDir, 'components.html');
            if (!(await fs.stat(workCompPath).catch(() => false))) {
                const archiveCompPath = path.join(ROOT_DIR, 'generated_projects', projectId, 'assets', 'components.html');
                if (await fs.stat(archiveCompPath).catch(() => false)) {
                    await fs.copyFile(archiveCompPath, workCompPath);
                    console.log(`[API] Restored components.html`);
                }
            }
        }

        // --- COMMAND GENERATION ---
        let cmdToRun = '';
        let cmdEnv: NodeJS.ProcessEnv = currentEnv;

        if (step === 'dna') {
            const themePath = path.join(projectWorkDir, 'theme.css');
            cmdToRun = `"${ASSEMBLER_VENV}" "${DNA_SCRIPT}" "${projectBriefPath}" "${themePath}"`;

        } else if (step === 'assets') {
            const ASSETS_SCRIPT = path.join(SKILLS_DIR, 'generate_assets', 'scripts', 'generate_components.py');
            const themePath = path.join(projectWorkDir, 'theme.css');
            cmdToRun = `"${ASSEMBLER_VENV}" "${ASSETS_SCRIPT}" "${themePath}" "${projectWorkDir}" --brief "${projectBriefPath}" --content "${projectDraftPath}"`;
            if (fromLog) {
                cmdToRun += ` --from-log "${path.join(projectWorkDir, 'components_log.html')}"`;
            }
            cmdEnv = { ...currentEnv, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '' };

        } else if (step === 'layout') {
            await fs.mkdir(projectHtmlDir, { recursive: true });
            const componentsPath = path.join(projectWorkDir, 'components.html');
            cmdToRun = `"${ASSEMBLER_VENV}" "${BUILDER_SCRIPT}" --brief "${projectBriefPath}" --content "${projectDraftPath}" --dna_dir "${projectWorkDir}" --output "${projectHtmlDir}" --components "${componentsPath}"`;
            if (filterSlides && Array.isArray(filterSlides) && filterSlides.length > 0) {
                cmdToRun += ` --slides "${filterSlides.join(',')}"`;
            }
            if (fromLog) {
                cmdToRun += ` --from-log "${path.join(projectHtmlDir, 'debug_logs')}"`;
            }

        } else if (step === 'assembly') {
            await fs.mkdir(projectPptxDir, { recursive: true });
            cmdToRun = `node "${ASSEMBLER_SCRIPT}" "${projectHtmlDir}" "${projectFinalOutput}"`;
            if (filterSlides && Array.isArray(filterSlides) && filterSlides.length > 0) {
                cmdToRun += ` --slides "${filterSlides.join(',')}"`;
            }

        } else if (step === 'qc') {
            cmdToRun = `"${ASSEMBLER_VENV}" "${QC_SCRIPT}" "${projectFinalOutput}" "${projectBriefPath}"`;
        }

        // --- EXECUTION BLOCK ---
        if (cmdToRun) {
            // Capture start time for versioning granularity (only archive files modified after this)
            // Use a slightly earlier buffer (e.g. 100ms) to ensure we don't miss files created immediately
            const startTime = Date.now() - 100;

            const syncCallback = async () => {
                if (projectId) {
                    await syncArtifacts(step, projectId, projectWorkDir, projectHtmlDir, projectFinalOutput, supabase, startTime);
                }
            };

            if (useStream) {
                console.log(`[API] Streaming requested for step: ${step}`);
                // Pass syncCallback to be executed on success
                const stream = await spawnCommand(cmdToRun, cmdEnv, syncCallback);
                return new NextResponse(stream);
            } else {
                console.log(`[API] Executing Buffered Command: ${cmdToRun}`);
                output = await runCommand(cmdToRun, cmdEnv);
                // Manually call sync
                await syncCallback();
                return NextResponse.json({ success: true, message: 'Command success', output });
            }
        }

        if (step === 'metrics' && !useStream) {
            return NextResponse.json({ success: true, message: 'Metrics not supported via this API yet.' });
        }

        return NextResponse.json({ success: false, error: 'Step not handled' }, { status: 400 });

    } catch (error: any) {
        console.error("API Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
