import { createServiceClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('accounting_portail_tokens')
    .select('id, label, is_active, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ exists: !!data, label: data?.label || null });
}
