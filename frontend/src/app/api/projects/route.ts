import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
    try {
        const supabase = await createClient();

        const { data: projects, error } = await supabase
            .from('projects')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching projects:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, projects });
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { id, project_name, user_prompt, brief_json, content_draft, model_used } = body;

        if (!project_name) {
            return NextResponse.json(
                { success: false, error: 'project_name is required' },
                { status: 400 }
            );
        }

        const supabase = await createClient();
        let result;

        if (id) {
            // Update existing project
            result = await supabase
                .from('projects')
                .update({
                    project_name,
                    user_prompt,
                    brief_json,
                    content_draft,
                    model_used,
                    // status: 'draft', // Don't reset status on update
                })
                .eq('id', id)
                .select()
                .single();
        } else {
            // Insert new project
            result = await supabase
                .from('projects')
                .insert({
                    project_name,
                    user_prompt,
                    brief_json: brief_json || {},
                    content_draft: content_draft || null,
                    status: 'draft',
                    model_used,
                })
                .select()
                .single();
        }

        const { data: project, error } = result;

        if (error) {
            console.error('Error saving project:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, project });
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
