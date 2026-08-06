-- =====================================================
-- المرحلة 1: النواة المحاسبية (ERP Phase 1)
-- إضافات جديدة بحتة — لا يتم تعديل أي جدول أو بيانات موجودة
-- السكربت idempotent بالكامل: إعادة تشغيله آمنة
-- متوافق مع PostgreSQL 15 / Supabase
-- =====================================================

-- -----------------------------------------------------
-- 1) جدول الحسابات (شجرة مبسطة) + البذر
-- -----------------------------------------------------
create table if not exists public.erp_accounts (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  name       text not null,
  kind       text not null check (kind in ('asset','liability','equity','revenue','expense')),
  created_at timestamptz not null default now()
);

insert into public.erp_accounts (code, name, kind) values
  ('1100', 'النقدية',        'asset'),
  ('1200', 'العملاء',        'asset'),
  ('1300', 'المخزون',        'asset'),
  ('2100', 'الموردون',       'liability'),
  ('4100', 'المبيعات',       'revenue'),
  ('5100', 'تكلفة المبيعات', 'expense')
on conflict (code) do nothing;

-- -----------------------------------------------------
-- 2) جدول قيود اليومية (رأس القيد)
-- -----------------------------------------------------
create table if not exists public.erp_journal_entries (
  id           uuid primary key default gen_random_uuid(),
  entry_number bigint unique,
  memo         text,
  ref_type     text,
  ref_id       text,
  created_at   timestamptz not null default now()
);

-- فهرس لمنع تكرار القيود لنفس المرجع ويدعم الـ idempotency
create unique index if not exists erp_journal_entries_ref_uniq
  on public.erp_journal_entries (ref_type, ref_id)
  where ref_type is not null and ref_id is not null;

-- -----------------------------------------------------
-- 3) جدول سطور القيود
-- -----------------------------------------------------
create table if not exists public.erp_journal_lines (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.erp_journal_entries(id) on delete cascade,
  account_id uuid not null references public.erp_accounts(id),
  party      text,
  debit      numeric(18,4) not null default 0,
  credit     numeric(18,4) not null default 0
);

create index if not exists erp_journal_lines_entry_idx on public.erp_journal_lines (entry_id);
create index if not exists erp_journal_lines_account_idx on public.erp_journal_lines (account_id);

-- -----------------------------------------------------
-- 4) منع التعديل والحذف على سطور القيود
--    القاعدة المحاسبية: التصحيح يكون بقيود عكسية فقط
-- -----------------------------------------------------
create or replace function public.erp_journal_lines_no_modify()
returns trigger
language plpgsql
as $$
begin
  raise exception 'سطور القيود غير قابلة للتعديل أو الحذف — التصحيح بقيد عكسي فقط';
end;
$$;

drop trigger if exists erp_journal_lines_no_update on public.erp_journal_lines;
create trigger erp_journal_lines_no_update
  before update on public.erp_journal_lines
  for each row execute function public.erp_journal_lines_no_modify();

drop trigger if exists erp_journal_lines_no_delete on public.erp_journal_lines;
create trigger erp_journal_lines_no_delete
  before delete on public.erp_journal_lines
  for each row execute function public.erp_journal_lines_no_modify();

-- -----------------------------------------------------
-- 5) جدول الترقيم + البذر
-- -----------------------------------------------------
create table if not exists public.erp_numbering (
  doc_type text primary key,
  next_no  bigint not null default 1
);

insert into public.erp_numbering (doc_type, next_no)
values ('journal', 1)
on conflict (doc_type) do nothing;

-- -----------------------------------------------------
-- 6) دالة الترقيم الذري (upsert + increment)
-- -----------------------------------------------------
create or replace function public.erp_next_number(p_doc text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no bigint;
begin
  insert into public.erp_numbering (doc_type, next_no)
  values (p_doc, 2)
  on conflict (doc_type) do update
    set next_no = public.erp_numbering.next_no + 1
  returning next_no - 1 into v_no;
  return v_no;
end;
$$;

-- -----------------------------------------------------
-- 7) ترحيل طلب واحد إلى قيد يومية
--    - idempotent: لا يكرر القيد لنفس الطلب
--    - الإجمالي: total إن وُجد و> 0، وإلا يُجمَع من items (JSON)
-- -----------------------------------------------------
create or replace function public.erp_post_order_journal(p_order_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      record;
  v_order_json jsonb;
  v_existing   bigint;
  v_total      numeric(18,4);
  v_entry_no   bigint;
  v_entry_id   uuid;
  v_acc_cust   uuid;
  v_acc_sales  uuid;
  v_item       jsonb;
  v_price      numeric;
  v_qty        numeric;
begin
  -- idempotency: هل يوجد قيد سابق لنفس الطلب؟
  select entry_number into v_existing
  from public.erp_journal_entries
  where ref_type = 'order' and ref_id = p_order_id::text
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  -- جلب الطلب
  select * into v_order
  from public.store_orders
  where id = p_order_id;

  if not found then
    raise exception 'الطلب % غير موجود في store_orders', p_order_id;
  end if;

  v_order_json := to_jsonb(v_order);

  -- حساب الإجمالي دفاعياً: total ثم بدائل شائعة، ثم التجميع من items
  v_total := coalesce(
    nullif(v_order_json ->> 'total', '')::numeric,
    nullif(v_order_json ->> 'total_amount', '')::numeric,
    nullif(v_order_json ->> 'grand_total', '')::numeric,
    nullif(v_order_json ->> 'amount', '')::numeric,
    0
  );

  if v_total <= 0 then
    v_total := 0;
    if v_order_json ? 'items' and jsonb_typeof(v_order_json -> 'items') = 'array' then
      for v_item in select * from jsonb_array_elements(v_order_json -> 'items')
      loop
        v_price := coalesce(
          nullif(v_item ->> 'price', '')::numeric,
          nullif(v_item ->> 'unit_price', '')::numeric,
          nullif(v_item ->> 'سعر', '')::numeric,
          0
        );
        v_qty := coalesce(
          nullif(v_item ->> 'qty', '')::numeric,
          nullif(v_item ->> 'quantity', '')::numeric,
          nullif(v_item ->> 'كمية', '')::numeric,
          1
        );
        v_total := v_total + (v_price * v_qty);
      end loop;
    end if;
  end if;

  if v_total <= 0 then
    raise exception 'إجمالي الطلب % صفر أو غير قابل للحساب — لا يمكن إنشاء قيد', p_order_id;
  end if;

  -- جلب الحسابات
  select id into v_acc_cust  from public.erp_accounts where code = '1200';
  select id into v_acc_sales from public.erp_accounts where code = '4100';

  if v_acc_cust is null or v_acc_sales is null then
    raise exception 'حسابات العملاء (1200) أو المبيعات (4100) غير موجودة في erp_accounts';
  end if;

  -- إنشاء القيد
  v_entry_no := public.erp_next_number('journal');

  insert into public.erp_journal_entries (entry_number, memo, ref_type, ref_id)
  values (
    v_entry_no,
    'قيد مبيعات — طلب رقم ' || coalesce(v_order_json ->> 'order_number', p_order_id::text),
    'order',
    p_order_id::text
  )
  returning id into v_entry_id;

  insert into public.erp_journal_lines (entry_id, account_id, party, debit, credit)
  values
    (v_entry_id, v_acc_cust,  v_order_json ->> 'customer_name', v_total, 0),
    (v_entry_id, v_acc_sales, null,                             0,       v_total);

  return v_entry_no;
end;
$$;

-- -----------------------------------------------------
-- 8) ترحيل كل الطلبات غير المرحّلة
-- -----------------------------------------------------
create or replace function public.erp_post_unposted_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select o.id
    from public.store_orders o
    where not exists (
      select 1
      from public.erp_journal_entries e
      where e.ref_type = 'order' and e.ref_id = o.id::text
    )
    order by o.created_at nulls last, o.id
  loop
    perform public.erp_post_order_journal(v_order.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------
-- 9) Views مشتقة (security_invoker لاحترام RLS)
-- -----------------------------------------------------

-- ميزان المراجعة: مجاميع وصافي رصيد كل حساب
create or replace view public.erp_v_trial_balance
with (security_invoker = true)
as
select
  a.code,
  a.name,
  a.kind,
  coalesce(sum(l.debit),  0) as total_debit,
  coalesce(sum(l.credit), 0) as total_credit,
  coalesce(sum(l.debit),  0) - coalesce(sum(l.credit), 0) as balance
from public.erp_accounts a
left join public.erp_journal_lines l on l.account_id = a.id
group by a.id, a.code, a.name, a.kind
order by a.code;

-- قائمة الدخل: إيرادات / مصروفات / صافي ربح كسطور
create or replace view public.erp_v_income_statement
with (security_invoker = true)
as
with sums as (
  select
    coalesce(sum(l.credit - l.debit) filter (where a.kind = 'revenue'), 0) as total_revenue,
    coalesce(sum(l.debit - l.credit) filter (where a.kind = 'expense'), 0) as total_expense
  from public.erp_journal_lines l
  join public.erp_accounts a on a.id = l.account_id
)
select 1 as sort_order, 'إجمالي الإيرادات'::text as line, total_revenue as amount from sums
union all
select 2, 'إجمالي المصروفات', total_expense from sums
union all
select 3, 'صافي الربح', total_revenue - total_expense from sums
order by sort_order;

-- -----------------------------------------------------
-- 10) RLS: قراءة للجميع، كتابة عبر دوال SECURITY DEFINER فقط
-- -----------------------------------------------------
alter table public.erp_accounts        enable row level security;
alter table public.erp_journal_entries enable row level security;
alter table public.erp_journal_lines   enable row level security;
alter table public.erp_numbering       enable row level security;

-- سياسات القراءة (لا سياسات كتابة إطلاقاً)
drop policy if exists erp_accounts_select on public.erp_accounts;
create policy erp_accounts_select on public.erp_accounts
  for select to anon, authenticated using (true);

drop policy if exists erp_journal_entries_select on public.erp_journal_entries;
create policy erp_journal_entries_select on public.erp_journal_entries
  for select to anon, authenticated using (true);

drop policy if exists erp_journal_lines_select on public.erp_journal_lines;
create policy erp_journal_lines_select on public.erp_journal_lines
  for select to anon, authenticated using (true);

drop policy if exists erp_numbering_select on public.erp_numbering;
create policy erp_numbering_select on public.erp_numbering
  for select to anon, authenticated using (true);

-- منح التنفيذ على الدوال
grant execute on function public.erp_next_number(text)          to anon, authenticated;
grant execute on function public.erp_post_order_journal(bigint) to anon, authenticated;
grant execute on function public.erp_post_unposted_orders()     to anon, authenticated;

-- -----------------------------------------------------
-- تحقق نهائي
-- -----------------------------------------------------
select
  (select count(*) from public.erp_accounts) as seeded_accounts,
  'تم تنفيذ المرحلة 1 من النواة المحاسبية بنجاح ✅' as message;
