import { NextResponse } from 'next/server';

import { getEffectiveLlmSettings, getLocalSettings, getSuggestedProjectRoot, setProjectRoot, updateLlmSettings } from '@/lib/server/local-settings';
import { getStorageMode } from '@/lib/server/project-store';

export async function GET() {
  try {
    const settings = await getLocalSettings();
    return NextResponse.json({
      success: true,
      storageMode: getStorageMode(),
      localSettings: settings,
      effectiveLlmSettings: await getEffectiveLlmSettings(),
      suggestedProjectRoot: getSuggestedProjectRoot(),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let projectRoot: string | null = null;
    if (body.projectRoot !== undefined) {
      projectRoot = await setProjectRoot(body.projectRoot ?? '');
    }

    const llm = body.llm ? await updateLlmSettings(body.llm) : (await getLocalSettings()).llm;
    const localSettings = await getLocalSettings();

    return NextResponse.json({
      success: true,
      storageMode: getStorageMode(),
      localSettings: { ...localSettings, projectRoot: projectRoot ?? localSettings.projectRoot, llm },
      effectiveLlmSettings: await getEffectiveLlmSettings(),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}
