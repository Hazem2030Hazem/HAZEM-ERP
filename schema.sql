-- ═══════════════════════════════════════════════════════════════
-- HAZEM ERP — سكربت قاعدة البيانات الشامل (PostgreSQL 15 / Supabase)
-- شغّله مرة واحدة في: Supabase Dashboard → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════

-- ─────────── ١) الجداول الأساسية ───────────

-- الشركات (المستأجرون)
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency char(3) not null default 'SAR',
  fy_start date,                          -- بداية السنة المالية
  created_at timestamptz not null default now()
);

-- عضويات المستخدمين في الشركات (ربط المستخدم بالشركة ودوره)
create table if not exists memberships (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',    -- owner | member
  primary key (tenant_id, user_id)
);

-- المخازن
create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  is_main boolean not null default false
);

-- الأصناف
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text,                                -- كود الصنف
  name text not null,
  unit text default 'حبة',
  sale_price numeric(18,4) not null default 0,
  unique (tenant_id, sku)
);

-- الأطراف: عملاء وموردون
create table if not exists parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  phone text,
  kind text not null check (kind in ('customer','supplier'))
);

-- شجرة الحسابات المبسطة
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null,
  name text not null,
  kind text,                               -- asset | liability | revenue | expense
  unique (tenant_id, code)
);

-- فواتير المبيعات
create table if not exists sales_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number bigint not null,
  customer_id uuid not null references parties(id),
  total numeric(18,4) not null default 0,
  status text not null default 'posted',
  created_at timestamptz not null default now(),
  unique (tenant_id, number)
);

-- سطور فواتير المبيعات
create table if not exists sales_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references sales_invoices(id) on delete cascade,
  item_id uuid not null references items(id),
  qty numeric(18,4) not null,
  price numeric(18,4) not null
);

-- قيود اليومية (رؤوس)
create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number bigint not null,
  memo text,
  created_at timestamptz not null default now(),
  unique (tenant_id, number)
);

-- سطور قيود اليومية — لا تُعدَّل ولا تُحذف (التصحيح بقيود عكسية فقط)
create table if not exists journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references accounts(id),
  party_id uuid references parties(id),    -- اختياري: ربط السطر بعميل/مورد
  debit numeric(18,4) not null default 0,
  credit numeric(18,4) not null default 0
);

-- حركات المخزون (الأرصدة تُشتق منها)
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid not null references items(id),
  warehouse_id uuid not null references warehouses(id),
  qty numeric(18,4) not null,              -- موجب = دخول / سالب = خروج
  reason text,                             -- opening | sale | adjust
  ref_id uuid,                             -- مرجع المستند المسبب
  created_at timestamptz not null default now()
);

-- تسلسلات الترقيم لكل شركة ونوع مستند
create table if not exists numbering_sequences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  doc_type text not null,                  -- sales_invoice | journal_entry
  next_no bigint not null default 1,
  primary key (tenant_id, doc_type)
);

-- ─────────── ٢) أمان مستوى الصف (RLS) ───────────
-- القاعدة: العضو يقرأ/يكتب فقط بيانات شركته
alter table tenants              enable row level security;
alter table memberships          enable row level security;
alter table warehouses           enable row level security;
alter table items                enable row level security;
alter table parties              enable row level security;
alter table accounts             enable row level security;
alter table sales_invoices       enable row level security;
alter table sales_invoice_lines  enable row level security;
alter table journal_entries      enable row level security;
alter table journal_entry_lines  enable row level security;
alter table stock_movements      enable row level security;
alter table numbering_sequences  enable row level security;

-- دالة مساعدة: هل المستخدم الحالي عضو في الشركة؟
create or replace function is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.tenant_id = p_tenant and m.user_id = auth.uid()
  );
$$;

-- سياسات tenants: العضو يقرأ شركته فقط (الإنشاء عبر create_company فقط)
drop policy if exists tenants_select on tenants;
create policy tenants_select on tenants for select using (is_member(id));

-- سياسات memberships
drop policy if exists memberships_select on memberships;
create policy memberships_select on memberships for select using (is_member(tenant_id));

-- سياسات موحدة للجداول التشغيلية (قراءة + كتابة للأعضاء)
do $$
declare t text;
begin
  foreach t in array array[
    'warehouses','items','parties','accounts','sales_invoices',
    'journal_entries','stock_movements','numbering_sequences']
  loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format(
      'create policy %I_rw on %I for all using (is_member(tenant_id)) with check (is_member(tenant_id))',
      t, t);
  end loop;
end $$;

-- سياسة خاصة لسطور الفواتير/القيود: tenant_id غير موجود فيها مباشرة، نتحقق عبر الأب
drop policy if exists sil_rw on sales_invoice_lines;
create policy sil_rw on sales_invoice_lines for all
  using (exists (select 1 from sales_invoices si where si.id = invoice_id and is_member(si.tenant_id)))
  with check (exists (select 1 from sales_invoices si where si.id = invoice_id and is_member(si.tenant_id)));

drop policy if exists jel_rw on journal_entry_lines;
create policy jel_rw on journal_entry_lines for all
  using (exists (select 1 from journal_entries je where je.id = entry_id and is_member(je.tenant_id)))
  with check (exists (select 1 from journal_entries je where je.id = entry_id and is_member(je.tenant_id)));

-- ─────────── ٣) الدوال (RPC) ───────────

-- إنشاء شركة جديدة: tenant + عضوية owner + مخزن رئيسي + الحسابات الستة + تسلسلات الترقيم
create or replace function create_company(p_name text, p_currency text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'اسم الشركة مطلوب';
  end if;

  insert into tenants (name, currency) values (trim(p_name), coalesce(p_currency,'SAR'))
  returning id into v_tenant;

  insert into memberships (tenant_id, user_id, role) values (v_tenant, auth.uid(), 'owner');
  insert into warehouses (tenant_id, name, is_main) values (v_tenant, 'المخزن الرئيسي', true);

  -- شجرة الحسابات المبسطة
  insert into accounts (tenant_id, code, name, kind) values
    (v_tenant, '1010', 'نقدية',     'asset'),
    (v_tenant, '1020', 'عملاء',     'asset'),
    (v_tenant, '2010', 'موردون',    'liability'),
    (v_tenant, '4010', 'مبيعات',    'revenue'),
    (v_tenant, '1030', 'مخزون',     'asset'),
    (v_tenant, '5010', 'ت.مبيعات',  'expense');

  -- تسلسلات الترقيم
  insert into numbering_sequences (tenant_id, doc_type, next_no) values
    (v_tenant, 'sales_invoice', 1),
    (v_tenant, 'journal_entry', 1);

  return v_tenant;
end $$;

-- رقم تالي ذري (upsert مع زيادة)
create or replace function next_number(p_tenant uuid, p_doc text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_no bigint;
begin
  insert into numbering_sequences (tenant_id, doc_type, next_no)
  values (p_tenant, p_doc, 2)
  on conflict (tenant_id, doc_type)
  do update set next_no = numbering_sequences.next_no + 1
  returning next_no - 1 into v_no;
  return v_no;
end $$;

-- ترحيل فاتورة مبيعات — معاملية بالكامل: أي خطأ يعني rollback تلقائي
create or replace function post_sales_invoice(p_customer uuid, p_lines jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_inv_id uuid;
  v_inv_no bigint;
  v_total numeric(18,4) := 0;
  v_wh uuid;
  v_acc_customers uuid;
  v_acc_sales uuid;
  v_line jsonb;
  v_entry_id uuid;
begin
  -- التحقق من المدخلات
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'الفاتورة يجب أن تحتوي سطوراً [{item_id, qty, price}]';
  end if;

  -- الشركة من سياق العميل + التحقق من العضوية
  select tenant_id into v_tenant from parties where id = p_customer;
  if v_tenant is null or not is_member(v_tenant) then
    raise exception 'غير مصرح: العميل غير موجود أو لست عضواً في الشركة';
  end if;

  -- حساب الإجمالي والتحقق من الأصناف
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line->>'qty')::numeric <= 0 then
      raise exception 'الكمية يجب أن تكون أكبر من صفر';
    end if;
    if not exists (select 1 from items where id = (v_line->>'item_id')::uuid and tenant_id = v_tenant) then
      raise exception 'صنف غير موجود في شركتك: %', v_line->>'item_id';
    end if;
    v_total := v_total + (v_line->>'qty')::numeric * (v_line->>'price')::numeric;
  end loop;

  -- المخزن الرئيسي وحسابات القيد
  select id into v_wh from warehouses where tenant_id = v_tenant and is_main limit 1;
  select id into v_acc_customers from accounts where tenant_id = v_tenant and code = '1020';
  select id into v_acc_sales from accounts where tenant_id = v_tenant and code = '4010';
  if v_wh is null or v_acc_customers is null or v_acc_sales is null then
    raise exception 'إعدادات الشركة غير مكتملة (مخزن/حسابات)';
  end if;

  -- إنشاء الفاتورة برقم تسلسلي
  v_inv_no := next_number(v_tenant, 'sales_invoice');
  insert into sales_invoices (tenant_id, number, customer_id, total)
  values (v_tenant, v_inv_no, p_customer, v_total)
  returning id into v_inv_id;

  -- سطور الفاتورة + حركات مخزون سالبة لكل سطر
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into sales_invoice_lines (invoice_id, item_id, qty, price)
    values (v_inv_id, (v_line->>'item_id')::uuid,
            (v_line->>'qty')::numeric, (v_line->>'price')::numeric);

    insert into stock_movements (tenant_id, item_id, warehouse_id, qty, reason, ref_id)
    values (v_tenant, (v_line->>'item_id')::uuid, v_wh,
            -(v_line->>'qty')::numeric, 'sale', v_inv_id);
  end loop;

  -- قيد يومية متوازن: مدين العملاء بالإجمالي / دائن المبيعات
  insert into journal_entries (tenant_id, number, memo)
  values (v_tenant, next_number(v_tenant, 'journal_entry'),
          'قيد فاتورة مبيعات رقم ' || v_inv_no)
  returning id into v_entry_id;

  insert into journal_entry_lines (entry_id, account_id, party_id, debit, credit) values
    (v_entry_id, v_acc_customers, p_customer, v_total, 0),
    (v_entry_id, v_acc_sales,     null,       0, v_total);

  return v_inv_no;
end $$;

-- ─────────── ٤) منع تعديل/حذف سطور القيود ───────────
create or replace function forbid_jel_change() returns trigger
language plpgsql as $$
begin
  raise exception 'سطور قيود اليومية لا تُعدَّل ولا تُحذف — التصحيح بقيد عكسي فقط';
end $$;

drop trigger if exists trg_jel_no_update on journal_entry_lines;
create trigger trg_jel_no_update
  before update or delete on journal_entry_lines
  for each row execute function forbid_jel_change();

-- ─────────── ٥) Views مساعدة (security_invoker لاحترام RLS) ───────────

-- أرصدة الأصناف مشتقة من حركات المخزون
create or replace view v_item_balances
with (security_invoker = true) as
select
  sm.tenant_id,
  sm.item_id,
  i.name  as item_name,
  sm.warehouse_id,
  w.name  as warehouse_name,
  coalesce(sum(sm.qty), 0) as balance
from stock_movements sm
join items i      on i.id = sm.item_id
join warehouses w on w.id = sm.warehouse_id
group by sm.tenant_id, sm.item_id, i.name, sm.warehouse_id, w.name;

-- أرصدة الأطراف مشتقة من سطور القيود (مدين - دائن)
create or replace view v_party_balances
with (security_invoker = true) as
select
  p.tenant_id,
  p.id as party_id,
  p.name,
  p.kind,
  coalesce(sum(jel.debit - jel.credit), 0) as balance
from parties p
left join journal_entry_lines jel on jel.party_id = p.id
group by p.tenant_id, p.id, p.name, p.kind;
