
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import mime from 'mime'; // You might need to install 'mime' or just hardcode text/html
import { getGeneratedProjectsDir } from '@/lib/server/project-store';

const ROOT_DIR = path.resolve(process.cwd(), '..');
const WORK_DIR = path.join(ROOT_DIR, 'pipeline_work');
const HTML_DIR = path.join(WORK_DIR, '1_html_slides');

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('file');
    const projectId = searchParams.get('projectId');

    if (!fileName) {
        return new NextResponse('File not specified', { status: 400 });
    }

    // Security check: prevent directory traversal
    const cleanFileName = path.basename(fileName);
    let filePath = '';

    // 1. Try Project Archive First (if ID provided)
    if (projectId) {
        const archiveDir = await getGeneratedProjectsDir();
        // Try layout folder first
        const layoutPath = path.join(archiveDir, projectId, 'layout', cleanFileName);
        // Try assets folder second (for components_preview.html)
        const assetPath = path.join(archiveDir, projectId, 'assets', cleanFileName);

        try {
            await fs.access(layoutPath);
            filePath = layoutPath;
        } catch {
            try {
                await fs.access(assetPath);
                filePath = assetPath;
            } catch {
                // Not found in archive, proceed to fallback
            }
        }
    }

    // 2. Fallback to Ephemeral Work Dir (Current Project)
    if (!filePath) {
        const workPath = path.join(HTML_DIR, cleanFileName);
        const assetPath = path.join(WORK_DIR, cleanFileName);

        try {
            await fs.access(workPath);
            filePath = workPath;
        } catch {
            filePath = assetPath; // Fallback to root work dir
        }
    }

    try {
        const fileBuffer = await fs.readFile(filePath);

        // Determine content type (default to text/html for our use case)
        const contentType = 'text/html';

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': contentType,
            },
        });
    } catch (error) {
        return new NextResponse('File not found', { status: 404 });
    }
}
