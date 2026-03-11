import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const monthKey = searchParams.get('month');
    const type = searchParams.get('type');
    const status = searchParams.get('status');

    const supabase = createServiceClient();
    let query = supabase
      .from('accounting_documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (monthKey) query = query.eq('month_key', monthKey);
    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ documents: data });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, status } = await request.json();
    if (!id || !status) {
      return NextResponse.json({ error: 'id et status requis' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('accounting_documents')
      .update({ status })
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    const supabase = createServiceClient();

    // Get document to find storage path
    const { data: doc } = await supabase
      .from('accounting_documents')
      .select('storage_path, type')
      .eq('id', id)
      .single();

    if (doc) {
      const bucket = doc.type === 'invoice' ? 'accounting-invoices' : 'accounting-tickets';
      await supabase.storage.from(bucket).remove([doc.storage_path]);
    }

    const { error } = await supabase
      .from('accounting_documents')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
