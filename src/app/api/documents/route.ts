import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const monthKey = searchParams.get('month');
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const category = searchParams.get('category');

    const supabase = createServiceClient();
    let query = supabase
      .from('accounting_documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (monthKey) query = query.eq('month_key', monthKey);
    if (type) query = query.eq('type', type);
    if (status) {
      query = query.eq('status', status);
    } else {
      // Par défaut, exclure les documents ignorés (non-factures)
      query = query.neq('status', 'ignored');
    }
    if (category) query = query.eq('category', category);

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
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: 'id requis' }, { status: 400 });
    }

    // Build update fields from allowed keys
    const allowedFields = ['status', 'month_key', 'amount_cents', 'extracted_vendor', 'extracted_date', 'title', 'description'];
    const updateFields: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updateFields[key] = body[key];
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('accounting_documents')
      .update(updateFields)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { ids, status } = await request.json();
    if (!ids || !Array.isArray(ids) || !status) {
      return NextResponse.json({ error: 'ids (array) et status requis' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('accounting_documents')
      .update({ status })
      .in('id', ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, updated: ids.length });
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
