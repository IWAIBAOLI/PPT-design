
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

const ROOT_DIR = path.resolve(process.cwd(), '..');
const SKILLS_DIR = path.join(ROOT_DIR, 'my_skills');
const BRIEF_PATH = path.join(ROOT_DIR, 'pipeline_input', 'full_brief.json');
const GENERATE_SCRIPT = path.join(SKILLS_DIR, 'create_design_brief', 'scripts', 'generate_brief.py');

// Use the VENV Python
const VENV_PYTHON = path.join(ROOT_DIR, 'venv', 'bin', 'python3');

// Custom LLM Config
const LLM_ENV = {
    ...process.env,
    OPENAI_API_KEY: 'Gemini-API-maxuning',
    OPENAI_BASE_URL: 'http://127.0.0.1:8317/v1',
};

const DRAFT_PATH = path.join(ROOT_DIR, 'pipeline_input', 'content_draft.json');
const DRAFT_SCRIPT = path.join(SKILLS_DIR, 'draft_content', 'scripts', 'draft_content.py');

export async function POST(request: Request) {
    try {
        const body = await request.json();

        if (body.action === 'draft') {
            const { prompt, model } = body;
            if (!prompt) return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });

            // Ensure pipeline_input dir exists
            await fs.mkdir(path.dirname(DRAFT_PATH), { recursive: true });

            const cmd = `"${VENV_PYTHON}" "${DRAFT_SCRIPT}" "${prompt.replace(/"/g, '\\"')}" "${DRAFT_PATH}"`;
            console.log(`Executing Draft: ${cmd}`);

            // Pass model via env if needed, though draft_content currently hardcodes or uses default
            const envWithModel: NodeJS.ProcessEnv = { ...LLM_ENV, OPENAI_MODEL: model || (LLM_ENV as any).OPENAI_MODEL };

            const { stdout, stderr } = await execPromise(cmd, { env: envWithModel });
            console.log(">> [Draft Script Output]:\n", stdout);
            if (stderr) console.warn(">> [Draft Script Error]:\n", stderr);

            const content = await fs.readFile(DRAFT_PATH, 'utf-8');
            return NextResponse.json({ success: true, draft: JSON.parse(content) });

        } else if (body.action === 'generate') {
            const { draftData, model } = body;
            if (!draftData) return NextResponse.json({ success: false, error: 'Draft Data is required' }, { status: 400 });

            // Write the (potentially edited) draft to file first
            await fs.writeFile(DRAFT_PATH, JSON.stringify(draftData, null, 2), 'utf-8');

            const cmd = `"${VENV_PYTHON}" "${GENERATE_SCRIPT}" "${DRAFT_PATH}" "${BRIEF_PATH}"`;
            console.log(`Executing Brief: ${cmd}`);

            const envWithModel: NodeJS.ProcessEnv = { ...LLM_ENV, OPENAI_MODEL: model || (LLM_ENV as any).OPENAI_MODEL };

            const { stdout, stderr } = await execPromise(cmd, { env: envWithModel });
            console.log(stdout);
            if (stderr) console.warn(stderr);

            const content = await fs.readFile(BRIEF_PATH, 'utf-8');
            return NextResponse.json({ success: true, brief: JSON.parse(content) });

        } else if (body.action === 'save') {
            const { brief } = body;
            if (!brief) return NextResponse.json({ success: false, error: 'Brief data is required' }, { status: 400 });

            await fs.writeFile(BRIEF_PATH, JSON.stringify(brief, null, 2), 'utf-8');
            return NextResponse.json({ success: true, message: 'Brief saved successfully' });
        }

        return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });

    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function GET() {
    try {
        const content = await fs.readFile(BRIEF_PATH, 'utf-8');
        return NextResponse.json({ success: true, brief: JSON.parse(content) });
    } catch (error: any) {
        return NextResponse.json({ success: true, brief: null });
    }
}
