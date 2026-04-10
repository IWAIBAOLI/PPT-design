import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();

        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('*')
            .eq('id', id)
            .single();

        if (projectError) {
            return NextResponse.json({ success: false, error: projectError.message }, { status: 500 });
        }

        const { data: results, error: resultsError } = await supabase
            .from('pipeline_results')
            .select('*')
            .eq('project_id', id)
            .order('created_at', { ascending: true });

        if (resultsError) {
            return NextResponse.json({ success: false, error: resultsError.message }, { status: 500 });
        }

        const { data: files, error: filesError } = await supabase
            .from('generated_files')
            .select('*')
            .eq('project_id', id)
            .order('created_at', { ascending: true });

        if (filesError) {
            return NextResponse.json({ success: false, error: filesError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            project: {
                ...project,
                pipeline_results: results,
                generated_files: files,
            },
        });
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const supabase = await createClient();

        const { data: project, error } = await supabase
            .from('projects')
            .update(body)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, project });
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();

        const { error } = await supabase
            .from('projects')
            .delete()
            .eq('id', id);

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
