/* ============================================================
   درة فارس الشمال — لوحة الإدارة المتكاملة V2
   ============================================================ */
(function(){
'use strict';

if (typeof supabaseClient === 'undefined' || !supabaseClient) {
  console.warn('Admin V2: Supabase client is unavailable.');
  return;
}

const adminState = { user: null, orders: [], services: [], customers: [], receipts: [], reviews: [], messages: [], settings: null };

const orderStatuses = { new:'جديد', review:'قيد المراجعة', processing:'قيد التجهيز', shipped:'تم الشحن', delivered:'تم التسليم', completed:'مكتمل', cancelled:'ملغي' };
const paymentStatuses = { pending:'بانتظار الدفع', review:'بانتظار مراجعة الإيصال', paid:'تم تأكيد الدفع', rejected:'مرفوض', refunded:'تم الاسترجاع' };
const serviceStatuses = { new:'جديد', contacted:'تم التواصل', inspection:'تمت المعاينة', in_progress:'قيد التنفيذ', completed:'مكتمل', cancelled:'ملغي' };
const receiptStatuses = { pending:'بانتظار المراجعة', approved:'مقبول', rejected:'مرفوض' };
const reviewStatuses = { pending:'بانتظار المراجعة', published:'منشور', hidden:'مخفي' };
const messageStatuses = { new:'جديدة', read:'مقروءة', replied:'تم الرد', archived:'مؤرشفة' };

function esc(v){ return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
function dateAr(v){ if(!v)return'—';try{return new Date(v).toLocaleString('ar-SA',{dateStyle:'medium',timeStyle:'short'})}catch(_){return String(v)} }
function money(v){ return Number(v||0).toLocaleString('ar-SA')+' ر.س'; }
function adminToast(m,t){ if(typeof showToast==='function')showToast(m,t);else alert(m); }

/* ========== سجل التدقيق — تسجيل صامت لا يكسر شيئاً لو الجدول غير موجود ========== */
window.logAudit=function(action,details){
  try{
    supabaseClient.from('audit_logs').insert([{action:String(action||''),details:String(details||'')}]).then(function(){},function(){});
  }catch(_){}
};

/* ========== تحميل مكتبات خارجية ديناميكياً عند الحاجة فقط ========== */
var adminScriptsLoaded={};
function loadAdminScript(src,globalName){
  if(globalName&&window[globalName])return Promise.resolve();
  if(adminScriptsLoaded[src])return adminScriptsLoaded[src];
  adminScriptsLoaded[src]=new Promise(function(resolve,reject){
    var s=document.createElement('script');s.src=src;s.async=true;
    s.onload=function(){resolve();};
    s.onerror=function(){adminScriptsLoaded[src]=null;reject(new Error('تعذر تحميل: '+src));};
    document.head.appendChild(s);
  });
  return adminScriptsLoaded[src];
}
function options(map,cur){ return Object.entries(map).map(([v,l])=>`<option value="${v}" ${v===cur?'selected':''}>${l}</option>`).join(''); }

async function currentUser(){ const {data}=await supabaseClient.auth.getUser();return data.user||null; }
async function isAdminUser(user){ if(!user)return false;const{data}=await supabaseClient.from('profiles').select('role').eq('id',user.id).maybeSingle();return data?.role==='admin'; }
async function getPanelRole(user){ if(!user)return null;const{data}=await supabaseClient.from('profiles').select('role').eq('id',user.id).maybeSingle();return data?.role||null; }
window.adminPanelRole = null;

/* ========== LOGIN ========== */
function openAdminPanel(){
  document.getElementById('loginPage').style.display='none';
  document.getElementById('dashboardLayout').classList.add('active');
  applyPanelRoleRestrictions();
  if(typeof loadProducts==='function')loadProducts();
  if(typeof loadSettings==='function')loadSettings();
  loadAdminV2Data();
}

function applyPanelRoleRestrictions(){
  if(window.adminPanelRole!=='staff')return;
  var allowed=['dashboard','orders','services','receipts','messages','security'];
  document.querySelectorAll('.sidebar a[onclick]').forEach(function(a){
    var m=(a.getAttribute('onclick')||'').match(/showTab\('([^']+)'\)/);
    if(m && allowed.indexOf(m[1])<0) a.style.display='none';
  });
  document.querySelectorAll('.sidebar .nav-section').forEach(function(s){ s.style.display='none'; });
  showTab('orders');
}
async function hasAuthSession(){
  try{
    var r=await supabaseClient.auth.getSession();
    return !!(r&&r.data&&r.data.session);
  }catch(_){return false;}
}

window.handleLogin=async function(e){
  e.preventDefault();
  var email=document.getElementById('username').value.trim(),password=document.getElementById('password').value;
  var btn=e.target.querySelector('button'),err=document.getElementById('errorMsg');
  err.style.display='none';btn.disabled=true;btn.textContent='⏳ جاري التحقق...';
  function loginFail(msg){btn.disabled=false;btn.textContent='دخول إلى لوحة التحكم';err.textContent=msg;err.style.display='block';}
  /* دخول آمن عبر Supabase Auth + فحص صلاحية الأدمن (profiles.role==='admin') — لا يوجد أي مسار بديل، واستعادة الجلسة تعتمد على getSession() فقط */
  try{
    var{data,error}=await supabaseClient.auth.signInWithPassword({email:email,password:password});
    if(error||!data||!data.user){loginFail('❌ بيانات الدخول غير صحيحة أو لم يُنشأ مستخدم الأدمن بعد (Authentication → Users)');return false;}
    var _role = await getPanelRole(data.user);
    if(_role !== 'admin' && _role !== 'staff'){try{await supabaseClient.auth.signOut();}catch(_){}loginFail('❌ لا تملك صلاحية الدخول للوحة');return false;}
    window.adminPanelRole = _role;
    logAudit('تسجيل دخول','دخول المدير إلى لوحة الإدارة عبر Supabase Auth: '+email);
    openAdminPanel();
  }catch(ex){
    console.warn('handleLogin:',ex);
    loginFail('❌ بيانات الدخول غير صحيحة أو لم يُنشأ مستخدم الأدمن بعد (Authentication → Users)');
  }
  return false;
};

window.logout=async function(){
  try{await supabaseClient.auth.signOut();}catch(_){}
  try{localStorage.clear();}catch(_){}
  location.reload();
};

window.showTab=function(tabName){
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  var tab=document.getElementById(tabName+'Tab');if(tab)tab.classList.add('active');
  document.querySelectorAll('.sidebar-nav a').forEach(a=>a.classList.remove('active'));
  if(tabName==='orders')loadOrders();
  if(tabName==='services')loadServiceRequests();
  if(tabName==='customers')loadCustomers();
  if(tabName==='receipts')loadReceipts();
  if(tabName==='reviews')loadReviews();
  if(tabName==='messages')loadMessages();
  if(tabName==='settings')loadSettings();
  if(tabName==='staff')loadStaff();
  if(tabName==='why_us')loadSiteItems('why_us');
  if(tabName==='vision_mission')loadSiteItems('vision_mission');
  if(tabName==='hero_stats')loadSiteItems('hero_stats');
  if(tabName==='home_hero')loadHomeHeroForm();
  if(tabName==='about')loadSiteItems('about');
  if(tabName==='testimonials')loadSiteItems('testimonials');
  if(tabName==='projects')loadSiteItems('projects');
  if(tabName==='blog')loadSiteItems('blog');
  if(tabName==='certifications')loadSiteItems('certifications');
  if(tabName==='contact')loadSiteItems('contact');
  if(tabName==='announcements')loadSiteItems('announcements');
  if(tabName==='afaky'){loadAfakySettings();loadAfakySyncLog();}
  if(tabName==='dashboard')renderDashboardCharts();
  if(tabName==='auditLog')loadAuditLog();
  if(tabName==='accounting'){loadErpJournal();loadErpTrialBalance();loadErpIncome();}
  if(tabName==='einvoice'){loadZatcaSettings();loadZatcaInvoices();}
  if(tabName==='bank_accounts')loadBankAccounts();
  if(tabName==='payment_methods')loadPaymentMethodsAdmin();
  if(tabName==='gateways')loadPaymentGateways();
  if(tabName==='shipping')loadShippingRates();
  if(tabName==='invoices')loadInvoices();
  if(tabName==='files')loadSiteFiles();
  if(tabName==='company_info')loadCompanyInfo();
  if(tabName==='gov_docs')loadGovDocs();
  if(tabName==='marketing')loadMarketing();
  var tabTitles={home_hero:'محتوى الصفحة الرئيسية',dashboard:'لوحة المؤشرات',accounting:'المحاسبة',auditLog:'سجل التدقيق',einvoice:'الفوترة الإلكترونية',bank_accounts:'الحسابات البنكية',payment_methods:'طرق الدفع',gateways:'بوابات الدفع',shipping:'الشحن',settings:'الإعدادات العامة',company_info:'بيانات الشركة',gov_docs:'التوثيق الحكومي',marketing:'التسويق',files:'الملفات'};
  document.getElementById('pageTitle').textContent=tabTitles[tabName]||tabName;
};

async function loadAdminV2Data(){await Promise.allSettled([loadOrders(),loadCustomers(),loadMessages()]);updateStats();}

window.loadProducts = async function() {
  var t = document.getElementById('productsTable');
  if (!t) return;
  t.innerHTML = '<tr><td colspan="7">⏳ تحميل...</td></tr>';
  var { data } = await supabaseClient.from('store_products').select('*').order('id');
  if (!data || !data.length) {
    t.innerHTML = '<tr><td colspan="7">📦 لا توجد منتجات</td></tr>';
    return;
  }
  t.innerHTML = data.map((p, i) => 
    `<tr>
      <td>${i+1}</td>
      <td style="width:50px; height:50px; text-align:center; vertical-align:middle; border-radius:6px; overflow:hidden; background:#f0f0f0;">
        <img src="${p.image}" style="width:100%; height:100%; object-fit:cover; display:block;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
        <svg style="display:none; width:24px; height:24px; margin:auto; color:#666;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
      </td>
      <td class="pt-name" title="${esc(p.name)}"><span class="pt-name-in">${esc(p.name)}</span></td>
      <td class="pt-desc">${esc((p.description || '').substring(0, 80))}</td>
      <td class="pt-price">${Number(p.price).toLocaleString()} ر.س</td>
      <td>${p.category}</td>
      <td>
        <button class="btn-edit" onclick="editProduct(${p.id})">✏️</button>
        <button class="btn-delete" onclick="deleteProduct(${p.id})">🗑️</button>
      </td>
    </tr>`
  ).join('');
  document.getElementById('totalProducts').textContent = data.length;
};

window.editProduct = async function(id) {
  var { data } = await supabaseClient.from('store_products').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('productId').value = data.id;
  document.getElementById('productName').value = data.name;
  document.getElementById('productDesc').value = data.description || '';
  document.getElementById('productPrice').value = data.price;
  document.getElementById('productOldPrice').value = data.old_price || '';
  document.getElementById('productStock').value = data.stock || 0;
  document.getElementById('productCategory').value = data.category;
  document.getElementById('productBadge').value = data.badge || '';
  document.getElementById('productImage').value = data.image || '';
  document.getElementById('productRating').value = data.rating || 0;
  document.getElementById('productModalTitle').textContent = '✏️ تعديل منتج';
  document.getElementById('productModal').classList.add('show');
};

window.deleteProduct = async function(id) {
  if (!confirm('حذف هذا المنتج؟')) return;
  var { error } = await supabaseClient.from('store_products').delete().eq('id', id);
  if (error) { adminToast('❌ خطأ: ' + error.message, 'error'); return; }
  adminToast('✅ تم الحذف بنجاح');
  logAudit('حذف منتج','منتج رقم: '+id);
  loadProducts();
};

window.openModal = function() {
  document.getElementById('productModal').classList.add('show');
  document.getElementById('productModalTitle').textContent = '📦 إضافة منتج';
  document.getElementById('productForm').reset();
  document.getElementById('productId').value = '';
};

window.closeProductModal = function() {
  document.getElementById('productModal').classList.remove('show');
};

window.saveProduct = async function(e) {
  e.preventDefault();
  var id = document.getElementById('productId').value;

  var product = {
    name: document.getElementById('productName').value,
    description: document.getElementById('productDesc').value,
    price: parseFloat(document.getElementById('productPrice').value),
    old_price: parseFloat(document.getElementById('productOldPrice').value) || null,
    stock: parseInt(document.getElementById('productStock').value) || 0,
    category: document.getElementById('productCategory').value,
    badge: document.getElementById('productBadge').value,
    image: document.getElementById('productImage').value,  // هذا الحقل هو المسؤول عن الصورة
    rating: parseFloat(document.getElementById('productRating').value) || 0,
    is_active: true
  };

  console.log('البيانات المرسلة:', product); // للتأكد من وجود رابط الصورة

  var btn = document.querySelector('#productForm .btn-save');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  var result, error;
  if (id) {
    result = await supabaseClient.from('store_products').update(product).eq('id', id);
    error = result.error;
  } else {
    result = await supabaseClient.from('store_products').insert(product);
    error = result.error;
  }

  btn.disabled = false; btn.textContent = '💾 حفظ المنتج';

  if (error) {
    adminToast('❌ خطأ: ' + error.message, 'error');
    console.error('خطأ Supabase:', error); // يوضح الخطأ في الكونسول
    return;
  }

  document.getElementById('productModal').classList.remove('show');
  adminToast('✅ تم الحفظ بنجاح');
  logAudit(id?'تعديل منتج':'إضافة منتج',(product.name||'بدون اسم')+(id?' (رقم: '+id+')':''));
  loadProducts();
  return false;
};
window.loadOrders=async function(){
  var c=document.getElementById('ordersList');if(!c)return;
  var{data}=await supabaseClient.from('store_orders').select('*').order('created_at',{ascending:false});
  adminState.orders=data||[];renderOrders();
};
function renderOrders(){
  var c=document.getElementById('ordersList');if(!c)return;
  if(!adminState.orders.length){c.innerHTML='<div class="admin-empty">🛒 لا توجد طلبات</div>';return;}
  c.innerHTML=adminState.orders.map(o=>`<div class="admin-data-card"><strong>${esc(o.order_number||o.id)}</strong> - ${money(o.total)} - ${esc(o.status)}</div>`).join('');
}

window.loadCustomers=async function(){
  var c=document.getElementById('customersList');if(!c)return;
  var{data}=await supabaseClient.from('profiles').select('*').order('created_at',{ascending:false});
  adminState.customers=data||[];renderCustomers();
};
function renderCustomers(){
  var c=document.getElementById('customersList');if(!c)return;
  if(!adminState.customers.length){c.innerHTML='<div class="admin-empty">👥 لا يوجد عملاء</div>';return;}
  c.innerHTML=adminState.customers.map(cu=>`<div class="admin-data-card"><strong>${esc(cu.full_name||'بدون اسم')}</strong> - ${esc(cu.phone||'—')}</div>`).join('');
}

window.loadServiceRequests=async function(){
  var c=document.getElementById('servicesList');if(!c)return;
  c.innerHTML='<div class="admin-empty">⏳ جاري تحميل الخدمات...</div>';
  var{data}=await supabaseClient.from('service_requests').select('*').order('created_at',{ascending:false});
  if(!data||!data.length){c.innerHTML='<div class="admin-empty">🔧 لا توجد طلبات خدمات</div>';return;}
  var html='<table><thead><tr><th>#</th><th>الخدمة</th><th>العميل</th><th>الجوال</th><th>المدينة</th><th>الحالة</th><th>التاريخ</th><th>الإجراءات</th></tr></thead><tbody>';
  data.forEach(function(s,i){
    html+='<tr><td>'+(i+1)+'</td><td>'+esc(s.service_type||'—')+'</td><td>'+esc(s.customer_name||'—')+'</td><td>'+esc(s.customer_phone||'—')+'</td><td>'+esc(s.city||'—')+'</td><td><select onchange="updateServiceStatus(\''+s.id+'\',this.value)"><option value="new" '+(s.status==='new'?'selected':'')+'>جديد</option><option value="contacted" '+(s.status==='contacted'?'selected':'')+'>تم التواصل</option><option value="in_progress" '+(s.status==='in_progress'?'selected':'')+'>قيد التنفيذ</option><option value="completed" '+(s.status==='completed'?'selected':'')+'>مكتمل</option><option value="cancelled" '+(s.status==='cancelled'?'selected':'')+'>ملغي</option></select></td><td>'+dateAr(s.created_at)+'</td><td><button class="btn-delete" onclick="deleteService(\''+s.id+'\')">🗑️</button></td></tr>';
  });
  html+='</tbody></table>';
  c.innerHTML=html;
};

window.updateServiceStatus=async function(id,status){
  await supabaseClient.from('service_requests').update({status:status}).eq('id',id);
  adminToast('✅ تم تحديث الحالة');
};

window.deleteService=async function(id){
  if(!confirm('حذف طلب الخدمة؟'))return;
  await supabaseClient.from('service_requests').delete().eq('id',id);
  loadServiceRequests();adminToast('✅ تم الحذف');
};

window.addService=async function(){
  var type=prompt('نوع الخدمة:');if(!type)return;
  var name=prompt('اسم العميل:');if(!name)return;
  var phone=prompt('الجوال:');if(!phone)return;
  var city=prompt('المدينة:');if(!city)return;
  var desc=prompt('الوصف:');if(!desc)return;
  var{error}=await supabaseClient.from('service_requests').insert([{service_type:type,customer_name:name,customer_phone:phone,city:city,description:desc,status:'new'}]);
  if(error){adminToast('❌ خطأ: '+error.message,'error');return;}
  adminToast('✅ تمت الإضافة');loadServiceRequests();
};
window.loadReceipts=async function(){
  var c=document.getElementById('receiptsList');if(!c)return;
  c.innerHTML='<div class="admin-empty">🧾 لا توجد إيصالات</div>';
};
window.loadReviews=async function(){
  var c=document.getElementById('reviewsList');if(!c)return;
  c.innerHTML='<div class="admin-empty">⏳ جاري تحميل التقييمات...</div>';
  var{data}=await supabaseClient.from('reviews').select('*').order('id',{ascending:false});
  if(!data||!data.length){c.innerHTML='<div class="admin-empty">⭐ لا توجد تقييمات</div>';return;}
  var html='<table><thead><tr><th>#</th><th>الاسم</th><th>المنتج</th><th>التقييم</th><th>التعليق</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>';
  data.forEach(function(r,i){
    html+='<tr><td>'+(i+1)+'</td><td>'+esc(r.name||'—')+'</td><td>'+esc(r.product||'—')+'</td><td>'+'★'.repeat(r.rating||5)+'</td><td>'+esc((r.text||'').substring(0,60))+'</td><td>'+esc(r.status||'جديد')+'</td><td><button class="btn-edit" onclick="updateReviewStatus('+r.id+',\'published\')">✅ نشر</button> <button class="btn-delete" onclick="deleteReviewAdmin('+r.id+')">🗑️</button></td></tr>';
  });
  html+='</tbody></table>';
  c.innerHTML=html;
};

window.updateReviewStatus=async function(id,status){
  await supabaseClient.from('reviews').update({status:status}).eq('id',id);
  loadReviews();adminToast('✅ تم التحديث');
};

window.deleteReviewAdmin=async function(id){
  if(!confirm('حذف التقييم؟'))return;
  await supabaseClient.from('reviews').delete().eq('id',id);
  logAudit('حذف تقييم','تقييم رقم: '+id);
  loadReviews();adminToast('✅ تم الحذف');
};
window.loadMessages=async function(){
  var c=document.getElementById('messagesList');if(!c)return;
  var{data}=await supabaseClient.from('contact_messages').select('*').order('created_at',{ascending:false});
  if(!data||!data.length){c.innerHTML='<div class="admin-empty">📨 لا توجد رسائل</div>';return;}
  c.innerHTML=data.map(m=>`<div class="admin-data-card"><strong>${esc(m.name)}</strong>: ${esc(m.message).substring(0,100)}</div>`).join('');
};

/* ========== مساعدات site_settings — قراءة/دمج/حفظ بدون مسح باقي المفاتيح ========== */
function formVal(id){var el=document.getElementById(id);return el?el.value.trim():'';}
function formSet(id,v){var el=document.getElementById(id);if(el)el.value=(v===null||v===undefined?'':v);}
async function siteSettingsGet(key){
  try{
    var{data}=await supabaseClient.from('site_settings').select('settings').eq('id',1).maybeSingle();
    var all=(data&&data.settings)||{};
    if(key==='_all_')return {all:all,value:{}};
    var v=all[key];
    if(typeof v==='string'){try{v=JSON.parse(v);}catch(_){v=null;}}
    return {all:all,value:(v&&typeof v==='object')?v:{}};
  }catch(e){console.warn('siteSettingsGet:',e);return {all:{},value:{}};}
}
async function siteSettingsSave(key,value,auditAction,auditDetails){
  try{
    var r=await siteSettingsGet('_all_');
    var all=r.all||{};
    all[key]=value;
    var{error}=await supabaseClient.from('site_settings').upsert([{id:1,settings:all}]);
    if(error){adminToast('❌ خطأ: '+error.message,'error');return false;}
    adminToast('✅ تم الحفظ بنجاح');
    logAudit(auditAction||'حفظ إعدادات',auditDetails||key);
    return true;
  }catch(e){console.warn('siteSettingsSave:',e);adminToast('❌ تعذر الحفظ','error');return false;}
}

/* ========== الإعدادات العامة — settings.general ========== */
window.loadSettings=async function(){
  var r=await siteSettingsGet('general');
  var g=r.value||{};
  formSet('setStoreName',g.store_name);
  formSet('setCurrency',g.currency||'ر.س');
  formSet('setTaxPercent',g.tax_percent!=null?g.tax_percent:15);
  formSet('setFreeShippingMin',g.free_shipping_min);
  formSet('setWhatsapp',g.whatsapp);
  if(typeof loadSocialLinks==='function')loadSocialLinks();
  if(typeof loadStoreStatus==='function')loadStoreStatus();
};
window.saveSettings=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var g={
    store_name:formVal('setStoreName'),
    currency:formVal('setCurrency')||'ر.س',
    tax_percent:parseFloat(formVal('setTaxPercent'))||0,
    free_shipping_min:parseFloat(formVal('setFreeShippingMin'))||0,
    whatsapp:formVal('setWhatsapp')
  };
  await siteSettingsSave('general',g,'حفظ الإعدادات العامة','الضريبة: '+g.tax_percent+'% — العملة: '+g.currency);
  return false;
};

/* ========== روابط السوشيال ميديا — تُحفظ كمفاتيح مباشرة يقرأها main.js ========== */
window.loadSocialLinks=async function(){
  try{
    var r=await siteSettingsGet('_all_');
    var all=r.all||{};
    formSet('setSocialFacebook',all.socialFacebook);
    formSet('setSocialInstagram',all.socialInstagram);
    formSet('setSocialTwitter',all.socialTwitter);
    formSet('setSocialLinkedin',all.socialLinkedin);
  }catch(e){console.warn('loadSocialLinks:',e);}
};
window.saveSocialLinks=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  try{
    var r=await siteSettingsGet('_all_');
    var all=r.all||{};
    all.socialFacebook=formVal('setSocialFacebook');
    all.socialInstagram=formVal('setSocialInstagram');
    all.socialTwitter=formVal('setSocialTwitter');
    all.socialLinkedin=formVal('setSocialLinkedin');
    var{error}=await supabaseClient.from('site_settings').upsert([{id:1,settings:all}]);
    if(error){adminToast('❌ خطأ: '+error.message,'error');return false;}
    adminToast('✅ تم حفظ روابط السوشيال — ستتفعّل الأيقونات في الموقع تلقائيًا');
    logAudit('حفظ روابط السوشيال','فيسبوك: '+(all.socialFacebook?'✓':'—')+' انستقرام: '+(all.socialInstagram?'✓':'—')+' تويتر: '+(all.socialTwitter?'✓':'—')+' لينكدإن: '+(all.socialLinkedin?'✓':'—'));
    return false;
  }catch(e2){console.warn('saveSocialLinks:',e2);adminToast('❌ تعذر الحفظ','error');return false;}
};

/* ========== محتوى الصفحة الرئيسية — site_items (home_hero) قراءة حية ========== */
window.loadHomeHeroForm=async function(){
  try{
    var{data}=await supabaseClient.from('site_items').select('*').eq('section_key','home_hero').order('sort_order').limit(1).maybeSingle();
    if(!data)return;
    var md=data.metadata||{};
    formSet('heroBadgeInput',md.badge);
    formSet('heroTitleInput',data.title_ar);
    formSet('heroHighlightInput',md.title_highlight);
    formSet('heroDescInput',data.description_ar);
    formSet('heroCtaTextInput',md.cta_text);
    formSet('heroCtaUrlInput',md.cta_url);
    formSet('heroStatClientsInput',md.stat_clients);
    formSet('heroStatClientsLabelInput',md.stat_clients_label);
  }catch(e){console.warn('loadHomeHeroForm:',e);}
};
window.saveHomeHero=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  try{
    var row={
      section_key:'home_hero',sort_order:1,is_active:true,
      title_ar:formVal('heroTitleInput'),
      description_ar:formVal('heroDescInput'),
      metadata:{
        badge:formVal('heroBadgeInput'),
        title_highlight:formVal('heroHighlightInput'),
        cta_text:formVal('heroCtaTextInput'),
        cta_url:formVal('heroCtaUrlInput'),
        stat_clients:formVal('heroStatClientsInput'),
        stat_clients_label:formVal('heroStatClientsLabelInput')
      }
    };
    var{data:ex}=await supabaseClient.from('site_items').select('id').eq('section_key','home_hero').limit(1).maybeSingle();
    var result;
    if(ex&&ex.id)result=await supabaseClient.from('site_items').update(row).eq('id',ex.id);
    else result=await supabaseClient.from('site_items').insert([row]);
    if(result.error){adminToast('❌ خطأ: '+result.error.message,'error');return false;}
    adminToast('✅ تم حفظ محتوى الصفحة الرئيسية — يظهر فورًا على الموقع');
    logAudit('حفظ محتوى الرئيسية','العنوان: '+(row.title_ar||'—'));
    return false;
  }catch(e2){console.warn('saveHomeHero:',e2);adminToast('❌ تعذر الحفظ','error');return false;}
};

/* ========== حالة المتجر — تُحفظ كمفتاح مباشر storeStatus يقرأه main.js ========== */
function storeStatusUpdateUI(st){
  var badge=document.getElementById('storeStatusBadge');
  if(!badge)return;
  var open=(st==='open');
  badge.textContent=open?'🟢 البيع مفعّل':'🔴 البيع متوقف للتجهيز';
  badge.style.background=open?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)';
  badge.style.color=open?'#10B981':'#EF4444';
}
window.loadStoreStatus=async function(){
  try{
    var r=await siteSettingsGet('_all_');
    var st=(r.all&&r.all.storeStatus)||'closed';
    formSet('setStoreStatus',st);
    storeStatusUpdateUI(st);
  }catch(e){console.warn('loadStoreStatus:',e);}
};
window.saveStoreStatus=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  try{
    var r=await siteSettingsGet('_all_');
    var all=r.all||{};
    all.storeStatus=formVal('setStoreStatus')||'closed';
    var{error}=await supabaseClient.from('site_settings').upsert([{id:1,settings:all}]);
    if(error){adminToast('❌ خطأ: '+error.message,'error');return false;}
    storeStatusUpdateUI(all.storeStatus);
    adminToast(all.storeStatus==='open'?'✅ المتجر مفتوح — البيع مفعّل الآن في كل الأجهزة':'✅ تم إيقاف البيع — الزوار يتصفحون فقط');
    logAudit('تغيير حالة المتجر',all.storeStatus==='open'?'فتح البيع':'إيقاف البيع للتجهيز');
    return false;
  }catch(e2){console.warn('saveStoreStatus:',e2);adminToast('❌ تعذر الحفظ','error');return false;}
};

/* ========== بيانات الشركة — settings.company ========== */
window.loadCompanyInfo=async function(){
  var r=await siteSettingsGet('company');
  var c=r.value||{};
  formSet('compOfficialName',c.official_name);
  formSet('compCR',c.commercial_register);
  formSet('compTaxNumber',c.tax_number);
  formSet('compAddress',c.address);
  formSet('compEmail',c.email);
  formSet('compPhone',c.phone);
};
window.saveCompanyInfo=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var c={
    official_name:formVal('compOfficialName'),
    commercial_register:formVal('compCR'),
    tax_number:formVal('compTaxNumber'),
    address:formVal('compAddress'),
    email:formVal('compEmail'),
    phone:formVal('compPhone')
  };
  await siteSettingsSave('company',c,'حفظ بيانات الشركة',c.official_name||'—');
  return false;
};

/* ========== التوثيق الحكومي — settings.gov_docs ========== */
function govDocsUpdateUI(g){
  g=g||{};
  var ok=!!(g.commercial_register&&g.tax_number);
  var badge=document.getElementById('govDocsStatus'),note=document.getElementById('govDocsStatusNote');
  if(badge){badge.textContent=ok?'🟢 موثق':'⚪ غير موثق';badge.classList.toggle('active',ok);}
  if(note)note.textContent=ok
    ?'بيانات التوثيق مكتملة — رقم السجل التجاري والرقم الضريبي مسجلان.'
    :'التوثيق غير مكتمل — أدخل رقم السجل التجاري والرقم الضريبي ثم احفظ.';
}
window.loadGovDocs=async function(){
  var r=await siteSettingsGet('gov_docs');
  var g=r.value||{};
  formSet('govCR',g.commercial_register);
  formSet('govTaxNumber',g.tax_number);
  formSet('govMaroofUrl',g.maroof_url);
  formSet('govNotes',g.notes);
  govDocsUpdateUI(g);
};
window.saveGovDocs=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var g={
    commercial_register:formVal('govCR'),
    tax_number:formVal('govTaxNumber'),
    maroof_url:formVal('govMaroofUrl'),
    notes:formVal('govNotes')
  };
  var ok=await siteSettingsSave('gov_docs',g,'حفظ التوثيق الحكومي','سجل: '+(g.commercial_register||'—')+' — ضريبي: '+(g.tax_number||'—'));
  if(ok)govDocsUpdateUI(g);
  return false;
};

/* ========== التسويق — settings.marketing ========== */
function marketingUpdateUI(m){
  m=m||{};
  var on=!!m.enabled;
  var badge=document.getElementById('marketingStatus'),note=document.getElementById('marketingStatusNote');
  if(badge){badge.textContent=on?'🟢 مفعل':'⚪ معطل';badge.classList.toggle('active',on);}
  if(note)note.textContent=on
    ?'الحملة التسويقية مفعلة — البانر الترويجي والكوبون الترحيبي ظاهران للزوار.'
    :'التسويق معطل حالياً — فعّل الحملة واحفظ لتظهر للزوار.';
}
window.loadMarketing=async function(){
  var r=await siteSettingsGet('marketing');
  var m=r.value||{};
  var en=document.getElementById('mktEnabled');if(en)en.checked=!!m.enabled;
  formSet('mktWelcomeCoupon',m.welcome_coupon);
  formSet('mktBannerMessage',m.banner_message);
  marketingUpdateUI(m);
};
window.saveMarketing=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var m={
    enabled:!!(document.getElementById('mktEnabled')||{}).checked,
    welcome_coupon:formVal('mktWelcomeCoupon'),
    banner_message:formVal('mktBannerMessage')
  };
  var ok=await siteSettingsSave('marketing',m,'حفظ إعدادات التسويق',m.enabled?'تفعيل الحملة — كوبون: '+(m.welcome_coupon||'—'):'تعطيل الحملة');
  if(ok)marketingUpdateUI(m);
  return false;
};

/* ========== الحسابات البنكية — CRUD على company_bank_accounts ========== */
window.loadBankAccounts=async function(){
  var c=document.getElementById('bankAccountsList');if(!c)return;
  c.innerHTML='<div class="admin-empty">⏳ جاري التحميل...</div>';
  try{
    var{data,error}=await supabaseClient.from('company_bank_accounts').select('*').order('sort_order').order('id');
    if(error)throw error;
    adminState.bankAccounts=data||[];
    if(!data.length){c.innerHTML='<div class="admin-empty">🏦 لا توجد حسابات بنكية — اضغط ➕ إضافة حساب.</div>';return;}
    var html='<table><thead><tr><th>#</th><th>البنك</th><th>صاحب الحساب</th><th>رقم الحساب</th><th>الآيبان</th><th>الترتيب</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>';
    data.forEach(function(a,i){
      html+='<tr><td>'+(i+1)+'</td><td><strong>'+esc(a.bank_name||'—')+'</strong></td><td>'+esc(a.account_name||'—')+'</td><td dir="ltr">'+esc(a.account_number||'—')+'</td><td dir="ltr">'+esc(a.iban||'—')+'</td><td>'+(a.sort_order==null?'—':a.sort_order)+'</td><td>'+(a.is_active?'<span class="sync-status-ok">✅ مفعّل</span>':'<span class="sync-status-fail">⛔ معطّل</span>')+'</td><td style="white-space:nowrap"><button class="btn-edit" onclick="editBankAccount(\''+a.id+'\')">✏️</button> <button class="btn-edit" onclick="toggleBankAccount(\''+a.id+'\','+(a.is_active?'true':'false')+')">'+(a.is_active?'⛔ تعطيل':'✅ تفعيل')+'</button> <button class="btn-delete" onclick="deleteBankAccount(\''+a.id+'\')">🗑️</button></td></tr>';
    });
    html+='</tbody></table>';
    c.innerHTML=html;
  }catch(e){
    console.warn('loadBankAccounts:',e);
    c.innerHTML='<div class="admin-empty">🏦 تعذر تحميل الحسابات — تأكد من وجود جدول company_bank_accounts في Supabase.</div>';
  }
};
window.addBankAccount=function(){
  var f=document.getElementById('bankAccountForm');if(f)f.reset();
  formSet('bankAccountId','');
  var act=document.getElementById('bankIsActive');if(act)act.checked=true;
  var t=document.getElementById('bankAccountModalTitle');if(t)t.textContent='🏦 إضافة حساب بنكي';
  var m=document.getElementById('bankAccountModal');if(m)m.classList.add('show');
};
window.editBankAccount=function(id){
  var a=(adminState.bankAccounts||[]).find(function(x){return String(x.id)===String(id);});
  if(!a){adminToast('⚠️ تعذر العثور على الحساب — حدّث القائمة','error');return;}
  formSet('bankAccountId',a.id);
  formSet('bankName',a.bank_name);
  formSet('bankAccountName',a.account_name);
  formSet('bankAccountNumber',a.account_number);
  formSet('bankIban',a.iban);
  formSet('bankSortOrder',a.sort_order!=null?a.sort_order:1);
  var act=document.getElementById('bankIsActive');if(act)act.checked=!!a.is_active;
  var t=document.getElementById('bankAccountModalTitle');if(t)t.textContent='✏️ تعديل حساب بنكي';
  var m=document.getElementById('bankAccountModal');if(m)m.classList.add('show');
};
window.closeBankAccountModal=function(){
  var m=document.getElementById('bankAccountModal');if(m)m.classList.remove('show');
};
window.saveBankAccount=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var id=formVal('bankAccountId');
  var rec={
    bank_name:formVal('bankName'),
    account_name:formVal('bankAccountName'),
    account_number:formVal('bankAccountNumber'),
    iban:formVal('bankIban'),
    sort_order:parseInt(formVal('bankSortOrder'))||0,
    is_active:!!(document.getElementById('bankIsActive')||{}).checked
  };
  if(!rec.bank_name||!rec.account_number){adminToast('⚠️ اسم البنك ورقم الحساب مطلوبان','error');return false;}
  try{
    var res=id
      ?await supabaseClient.from('company_bank_accounts').update(rec).eq('id',id)
      :await supabaseClient.from('company_bank_accounts').insert([rec]);
    if(res.error)throw res.error;
    closeBankAccountModal();
    adminToast('✅ تم حفظ الحساب البنكي');
    logAudit(id?'تعديل حساب بنكي':'إضافة حساب بنكي',rec.bank_name+' — '+(rec.iban||rec.account_number));
    loadBankAccounts();
  }catch(err){
    console.warn('saveBankAccount:',err);
    adminToast('❌ تعذر الحفظ: '+((err&&err.message)||err),'error');
  }
  return false;
};
window.toggleBankAccount=async function(id,current){
  try{
    var{error}=await supabaseClient.from('company_bank_accounts').update({is_active:!current}).eq('id',id);
    if(error)throw error;
    adminToast(!current?'✅ تم تفعيل الحساب':'⛔ تم تعطيل الحساب');
    logAudit('تغيير حالة حساب بنكي','حساب رقم '+id+' → '+(!current?'مفعّل':'معطّل'));
    loadBankAccounts();
  }catch(e){console.warn('toggleBankAccount:',e);adminToast('❌ تعذر تحديث الحالة','error');}
};
window.deleteBankAccount=async function(id){
  if(!confirm('حذف هذا الحساب البنكي؟'))return;
  try{
    var{error}=await supabaseClient.from('company_bank_accounts').delete().eq('id',id);
    if(error)throw error;
    adminToast('✅ تم حذف الحساب');
    logAudit('حذف حساب بنكي','حساب رقم: '+id);
    loadBankAccounts();
  }catch(e){console.warn('deleteBankAccount:',e);adminToast('❌ تعذر الحذف','error');}
};

/* ========== طرق الدفع — CRUD + ترتيب على payment_methods (تقرأها checkout مباشرة) ========== */
window.loadPaymentMethodsAdmin=async function(){
  var c=document.getElementById('paymentMethodsTable');if(!c)return;
  c.innerHTML='<tr><td colspan="6">⏳ جاري التحميل...</td></tr>';
  try{
    var{data,error}=await supabaseClient.from('payment_methods').select('*').order('sort_order').order('id');
    if(error)throw error;
    adminState.paymentMethods=data||[];
    if(!data.length){c.innerHTML='<tr><td colspan="6">💳 لا توجد طرق دفع — اضغط ➕ إضافة طريقة.</td></tr>';return;}
    c.innerHTML=data.map(function(m,i){
      var upBtn='<button class="btn-edit" title="أعلى" onclick="movePaymentMethod(\''+m.id+'\',-1)"'+(i===0?' disabled':'')+'>▲</button>';
      var downBtn='<button class="btn-edit" title="أسفل" onclick="movePaymentMethod(\''+m.id+'\',1)"'+(i===data.length-1?' disabled':'')+'>▼</button>';
      return '<tr><td>'+(i+1)+'</td><td style="font-size:20px">'+esc(m.icon||'💳')+'</td><td><strong>'+esc(m.name||'—')+'</strong></td><td>'+(m.sort_order==null?'—':m.sort_order)+'</td><td>'+(m.is_active?'<span class="sync-status-ok">✅ مفعّلة</span>':'<span class="sync-status-fail">⛔ معطّلة</span>')+'</td><td style="white-space:nowrap">'+upBtn+' '+downBtn+' <button class="btn-edit" onclick="editPaymentMethod(\''+m.id+'\')">✏️</button> <button class="btn-edit" onclick="togglePaymentMethod(\''+m.id+'\','+(m.is_active?'true':'false')+')">'+(m.is_active?'⛔':'✅')+'</button> <button class="btn-delete" onclick="deletePaymentMethod(\''+m.id+'\')">🗑️</button></td></tr>';
    }).join('');
  }catch(e){
    console.warn('loadPaymentMethodsAdmin:',e);
    c.innerHTML='<tr><td colspan="6">💳 تعذر تحميل طرق الدفع — تأكد من وجود جدول payment_methods في Supabase.</td></tr>';
  }
};
window.openPaymentMethodModal=function(){
  var f=document.getElementById('paymentMethodForm');if(f)f.reset();
  formSet('paymentMethodId','');
  var act=document.getElementById('pmIsActive');if(act)act.checked=true;
  var t=document.getElementById('paymentMethodModalTitle');if(t)t.textContent='💳 إضافة طريقة دفع';
  var m=document.getElementById('paymentMethodModal');if(m)m.classList.add('show');
};
window.editPaymentMethod=function(id){
  var m=(adminState.paymentMethods||[]).find(function(x){return String(x.id)===String(id);});
  if(!m){adminToast('⚠️ تعذر العثور على الطريقة — حدّث القائمة','error');return;}
  formSet('paymentMethodId',m.id);
  formSet('pmName',m.name);
  formSet('pmIcon',m.icon);
  formSet('pmSortOrder',m.sort_order!=null?m.sort_order:1);
  var act=document.getElementById('pmIsActive');if(act)act.checked=!!m.is_active;
  var t=document.getElementById('paymentMethodModalTitle');if(t)t.textContent='✏️ تعديل طريقة دفع';
  var md=document.getElementById('paymentMethodModal');if(md)md.classList.add('show');
};
window.closePaymentMethodModal=function(){
  var m=document.getElementById('paymentMethodModal');if(m)m.classList.remove('show');
};
window.savePaymentMethod=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var id=formVal('paymentMethodId');
  var rec={
    name:formVal('pmName'),
    icon:formVal('pmIcon')||'💳',
    sort_order:parseInt(formVal('pmSortOrder'))||0,
    is_active:!!(document.getElementById('pmIsActive')||{}).checked
  };
  if(!rec.name){adminToast('⚠️ اسم طريقة الدفع مطلوب','error');return false;}
  try{
    var res=id
      ?await supabaseClient.from('payment_methods').update(rec).eq('id',id)
      :await supabaseClient.from('payment_methods').insert([rec]);
    if(res.error)throw res.error;
    closePaymentMethodModal();
    adminToast('✅ تم حفظ طريقة الدفع');
    logAudit(id?'تعديل طريقة دفع':'إضافة طريقة دفع',rec.name);
    loadPaymentMethodsAdmin();
  }catch(err){
    console.warn('savePaymentMethod:',err);
    adminToast('❌ تعذر الحفظ: '+((err&&err.message)||err),'error');
  }
  return false;
};
window.togglePaymentMethod=async function(id,current){
  try{
    var{error}=await supabaseClient.from('payment_methods').update({is_active:!current}).eq('id',id);
    if(error)throw error;
    adminToast(!current?'✅ تم تفعيل الطريقة':'⛔ تم تعطيل الطريقة');
    logAudit('تغيير حالة طريقة دفع','طريقة رقم '+id+' → '+(!current?'مفعّلة':'معطّلة'));
    loadPaymentMethodsAdmin();
  }catch(e){console.warn('togglePaymentMethod:',e);adminToast('❌ تعذر تحديث الحالة','error');}
};
window.movePaymentMethod=async function(id,dir){
  var list=(adminState.paymentMethods||[]).slice();
  var idx=list.findIndex(function(m){return String(m.id)===String(id);});
  var swap=idx+dir;
  if(idx<0||swap<0||swap>=list.length)return;
  var a=list[idx],b=list[swap];
  var ao=(a.sort_order==null?idx+1:a.sort_order),bo=(b.sort_order==null?swap+1:b.sort_order);
  if(ao===bo)bo=ao+dir;
  try{
    var r1=await supabaseClient.from('payment_methods').update({sort_order:bo}).eq('id',a.id);
    if(r1.error)throw r1.error;
    var r2=await supabaseClient.from('payment_methods').update({sort_order:ao}).eq('id',b.id);
    if(r2.error)throw r2.error;
    adminToast('✅ تم تحديث الترتيب');
    logAudit('إعادة ترتيب طرق الدفع',(a.name||a.id)+' ↔ '+(b.name||b.id));
    loadPaymentMethodsAdmin();
  }catch(e){console.warn('movePaymentMethod:',e);adminToast('❌ تعذر تحديث الترتيب','error');}
};
window.deletePaymentMethod=async function(id){
  if(!confirm('حذف طريقة الدفع هذه؟ ستختفي من صفحة الدفع فوراً.'))return;
  try{
    var{error}=await supabaseClient.from('payment_methods').delete().eq('id',id);
    if(error)throw error;
    adminToast('✅ تم حذف الطريقة');
    logAudit('حذف طريقة دفع','طريقة رقم: '+id);
    loadPaymentMethodsAdmin();
  }catch(e){console.warn('deletePaymentMethod:',e);adminToast('❌ تعذر الحذف','error');}
};

/* ========== الشحن — CRUD على shipping_rates + سعر افتراضي في settings.shipping ========== */
window.loadShippingRates=async function(){
  try{
    var sr=await siteSettingsGet('shipping');
    formSet('shippingDefaultPrice',sr.value.default_price);
  }catch(_){}
  var c=document.getElementById('shippingRatesTable');if(!c)return;
  c.innerHTML='<tr><td colspan="7">⏳ جاري التحميل...</td></tr>';
  try{
    var{data,error}=await supabaseClient.from('shipping_rates').select('*').order('id');
    if(error)throw error;
    adminState.shippingRates=data||[];
    if(!data.length){c.innerHTML='<tr><td colspan="7">🚚 لا توجد أسعار شحن — اضغط ➕ إضافة سعر.</td></tr>';return;}
    c.innerHTML=data.map(function(r,i){
      return '<tr><td>'+(i+1)+'</td><td>'+esc(r.from_city||'—')+'</td><td><strong>'+esc(r.to_city||'—')+'</strong></td><td>'+(r.weight_kg==null?'—':r.weight_kg)+'</td><td>'+money(r.price_sar)+'</td><td>'+(r.estimated_days==null?'—':r.estimated_days+' يوم')+'</td><td style="white-space:nowrap"><button class="btn-edit" onclick="editShippingRate(\''+r.id+'\')">✏️</button> <button class="btn-delete" onclick="deleteShippingRate(\''+r.id+'\')">🗑️</button></td></tr>';
    }).join('');
  }catch(e){
    console.warn('loadShippingRates:',e);
    c.innerHTML='<tr><td colspan="7">🚚 تعذر تحميل أسعار الشحن — تأكد من وجود جدول shipping_rates في Supabase.</td></tr>';
  }
};
window.saveShippingSettings=async function(){
  var p=parseFloat(formVal('shippingDefaultPrice'))||0;
  await siteSettingsSave('shipping',{default_price:p},'حفظ إعدادات الشحن','السعر الافتراضي: '+p+' ر.س');
};
window.openShippingRateModal=function(){
  var f=document.getElementById('shippingRateForm');if(f)f.reset();
  formSet('shippingRateId','');
  var t=document.getElementById('shippingRateModalTitle');if(t)t.textContent='🚚 إضافة سعر شحن';
  var m=document.getElementById('shippingRateModal');if(m)m.classList.add('show');
};
window.editShippingRate=function(id){
  var r=(adminState.shippingRates||[]).find(function(x){return String(x.id)===String(id);});
  if(!r){adminToast('⚠️ تعذر العثور على السعر — حدّث القائمة','error');return;}
  formSet('shippingRateId',r.id);
  formSet('shipFromCity',r.from_city);
  formSet('shipToCity',r.to_city);
  formSet('shipWeight',r.weight_kg);
  formSet('shipPrice',r.price_sar);
  formSet('shipDays',r.estimated_days);
  var t=document.getElementById('shippingRateModalTitle');if(t)t.textContent='✏️ تعديل سعر شحن';
  var m=document.getElementById('shippingRateModal');if(m)m.classList.add('show');
};
window.closeShippingRateModal=function(){
  var m=document.getElementById('shippingRateModal');if(m)m.classList.remove('show');
};
window.saveShippingRate=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var id=formVal('shippingRateId');
  var rec={
    from_city:formVal('shipFromCity')||null,
    to_city:formVal('shipToCity'),
    weight_kg:formVal('shipWeight')!==''?(parseFloat(formVal('shipWeight'))||0):null,
    price_sar:parseFloat(formVal('shipPrice'))||0,
    estimated_days:formVal('shipDays')!==''?(parseInt(formVal('shipDays'))||0):null
  };
  if(!rec.to_city){adminToast('⚠️ مدينة الوصول مطلوبة','error');return false;}
  try{
    var res=id
      ?await supabaseClient.from('shipping_rates').update(rec).eq('id',id)
      :await supabaseClient.from('shipping_rates').insert([rec]);
    if(res.error)throw res.error;
    closeShippingRateModal();
    adminToast('✅ تم حفظ سعر الشحن');
    logAudit(id?'تعديل سعر شحن':'إضافة سعر شحن',(rec.from_city||'—')+' → '+rec.to_city+': '+rec.price_sar+' ر.س');
    loadShippingRates();
  }catch(err){
    console.warn('saveShippingRate:',err);
    adminToast('❌ تعذر الحفظ: '+((err&&err.message)||err),'error');
  }
  return false;
};
window.deleteShippingRate=async function(id){
  if(!confirm('حذف سعر الشحن هذا؟'))return;
  try{
    var{error}=await supabaseClient.from('shipping_rates').delete().eq('id',id);
    if(error)throw error;
    adminToast('✅ تم حذف السعر');
    logAudit('حذف سعر شحن','سعر رقم: '+id);
    loadShippingRates();
  }catch(e){console.warn('deleteShippingRate:',e);adminToast('❌ تعذر الحذف','error');}
};

window.loadInvoices=async function(){
  var c=document.getElementById('invoicesTable');if(!c)return;
  c.innerHTML='<tr><td colspan="7">🧾 لا توجد فواتير</td></tr>';
};

/* ========== الملفات الثابتة — قراءة فقط ========== */
var SITE_STATIC_FILES=[
  {icon:'📄',name:'الملف التعريفي للشركة (PDF)',path:'DFS_Company_profile.pdf.pdf',desc:'البروفايل الرسمي لشركة درة فارس الشمال — يُستخدم في صفحة التحميل/التعريف.'},
  {icon:'📱',name:'تطبيق أندرويد (APK)',path:'app-release.apk',desc:'نسخة الإصدار من تطبيق المتجر لأجهزة أندرويد — رابط التحميل في صفحة download.'},
  {icon:'⚙️',name:'ملف Manifest (PWA)',path:'manifest.json',desc:'إعدادات تطبيق الويب التقدمي: الاسم، الأيقونات، ألوان الثيم.'}
];
window.loadSiteFiles=async function(){
  var c=document.getElementById('siteFilesList');if(!c)return;
  c.innerHTML=SITE_STATIC_FILES.map(function(f){
    return '<div class="admin-data-card"><div class="admin-card-title"><strong>'+f.icon+' '+esc(f.name)+'</strong></div><div class="admin-note">'+esc(f.desc)+'</div><div class="admin-meta"><span dir="ltr">'+esc(f.path)+'</span></div><div class="admin-card-actions"><button class="btn-view" onclick="openSiteFile(\''+f.path+'\')">🔗 فتح الملف</button> <button class="btn-edit" onclick="copySiteFileLink(\''+f.path+'\')">📋 نسخ الرابط</button></div></div>';
  }).join('');
};
window.openSiteFile=function(path){
  try{window.open(encodeURI(path),'_blank');}catch(e){console.warn('openSiteFile:',e);adminToast('❌ تعذر فتح الملف','error');}
};
window.copySiteFileLink=function(path){
  var url=path;
  try{url=new URL(path,location.href).href;}catch(_){}
  var done=function(){adminToast('✅ تم نسخ رابط الملف');};
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(done,function(){adminToast('🔗 الرابط: '+url);});
    }else adminToast('🔗 الرابط: '+url);
  }catch(e){console.warn('copySiteFileLink:',e);adminToast('🔗 الرابط: '+url);}
};
window.addNewFile=function(){alert('الرفع غير متاح — تبويب الملفات للعرض فقط');};

window.loadSiteItems=async function(sectionKey){
  var container=document.getElementById(sectionKey+'List');if(!container)return;
  container.innerHTML='<div class="admin-empty">⏳ جاري التحميل...</div>';
  var{data}=await supabaseClient.from('site_items').select('*').eq('section_key',sectionKey).order('sort_order');
  if(!data||!data.length){container.innerHTML='<div class="admin-empty">📭 لا توجد بيانات. اضغط ➕ إضافة.</div>';return;}
  var html='<table><thead><tr><th>#</th><th>العنوان</th><th>الوصف</th><th>الترتيب</th><th>الإجراءات</th></tr></thead><tbody>';
  data.forEach(function(item,i){
    html+='<tr><td>'+(i+1)+'</td><td><strong>'+esc(item.title_ar||'بدون عنوان')+'</strong></td><td>'+esc((item.description_ar||'').substring(0,50))+'</td><td>'+item.sort_order+'</td><td><button class="btn-edit" onclick="editSiteItem('+item.id+')">✏️</button> <button class="btn-delete" onclick="deleteSiteItem('+item.id+',\''+sectionKey+'\')">🗑️</button></td></tr>';
  });
  html+='</tbody></table>';container.innerHTML=html;
};

window.addSiteItem=async function(sectionKey){
  var title=prompt('العنوان:');if(!title)return;
  var desc=prompt('الوصف:')||'';
  var sort=parseInt(prompt('الترتيب:','1'))||1;
  var{error}=await supabaseClient.from('site_items').insert([{section_key:sectionKey,title_ar:title,description_ar:desc,sort_order:sort}]);
  if(error){adminToast('❌ خطأ: '+error.message,'error');return;}
  adminToast('✅ تمت الإضافة');loadSiteItems(sectionKey);
};

window.editSiteItem=async function(id){
  var{data}=await supabaseClient.from('site_items').select('*').eq('id',id).single();
  if(!data)return;
  var title=prompt('العنوان:',data.title_ar);if(title===null)return;
  var desc=prompt('الوصف:',data.description_ar||'');if(desc===null)return;
  var sort=parseInt(prompt('الترتيب:',data.sort_order))||data.sort_order;
  await supabaseClient.from('site_items').update({title_ar:title,description_ar:desc,sort_order:sort}).eq('id',id);
  adminToast('✅ تم التعديل');loadSiteItems(data.section_key);
};

window.deleteSiteItem=async function(id,sectionKey){
  if(!confirm('حذف؟'))return;
  await supabaseClient.from('site_items').delete().eq('id',id);
  adminToast('✅ تم الحذف');loadSiteItems(sectionKey);
};

window.saveEInvoice=async function(){adminToast('✅ تم حفظ الفوترة');};

window.updateStats=async function(){
  var setStat=function(id,val){var el=document.getElementById(id);if(el)el.textContent=val;};
  var newOrders=0,newMessages=0;
  try{
    var pe=document.getElementById('totalProducts');
    if(pe){
      var{count}=await supabaseClient.from('store_products').select('*',{count:'exact',head:true});
      if(count==null){var{data:pd}=await supabaseClient.from('store_products').select('id');count=(pd||[]).length;}
      pe.textContent=count||0;
    }
  }catch(e){console.warn('updateStats products:',e);setStat('totalProducts',0);}
  try{
    var ae=document.getElementById('totalOrdersAll');
    if(ae){var{count:ac}=await supabaseClient.from('store_orders').select('*',{count:'exact',head:true});ae.textContent=ac||0;}
  }catch(e){console.warn('updateStats orders all:',e);setStat('totalOrdersAll',0);}
  try{
    var oe=document.getElementById('totalOrders');
    var{count:oc}=await supabaseClient.from('store_orders').select('*',{count:'exact',head:true}).eq('status','new');
    newOrders=oc||0;if(oe)oe.textContent=newOrders;
  }catch(e){console.warn('updateStats new orders:',e);setStat('totalOrders',0);}
  try{
    var ce=document.getElementById('totalCustomers');
    if(ce){var{count:cc}=await supabaseClient.from('profiles').select('*',{count:'exact',head:true});ce.textContent=cc||0;}
  }catch(e){console.warn('updateStats customers:',e);setStat('totalCustomers',0);}
  try{
    var te=document.getElementById('todaySales');
    if(te){
      var todayStart=new Date();todayStart.setHours(0,0,0,0);
      var{data:todayOrders}=await supabaseClient.from('store_orders').select('total').gte('created_at',todayStart.toISOString());
      var todaySum=(todayOrders||[]).reduce(function(s,o){return s+Number(o.total||0);},0);
      te.textContent=todaySum.toLocaleString('ar-SA')+' ر.س';
    }
  }catch(e){console.warn('updateStats today sales:',e);setStat('todaySales','0 ر.س');}
  try{
    var mse=document.getElementById('monthSales');
    if(mse){
      var now=new Date(),monthStart=new Date(now.getFullYear(),now.getMonth(),1);
      var{data:monthOrders}=await supabaseClient.from('store_orders').select('total').gte('created_at',monthStart.toISOString());
      var monthSum=(monthOrders||[]).reduce(function(s,o){return s+Number(o.total||0);},0);
      mse.textContent=monthSum.toLocaleString('ar-SA')+' ر.س';
    }
  }catch(e){console.warn('updateStats month sales:',e);setStat('monthSales','0 ر.س');}
  try{
    var re=document.getElementById('totalReviews');
    if(re){var{count:rc}=await supabaseClient.from('reviews').select('*',{count:'exact',head:true});re.textContent=rc||0;}
  }catch(e){console.warn('updateStats reviews:',e);setStat('totalReviews',0);}
  try{
    var me=document.getElementById('totalMessages');
    var{count:mc}=await supabaseClient.from('contact_messages').select('*',{count:'exact',head:true}).eq('status','new');
    newMessages=mc||0;if(me)me.textContent=newMessages;
  }catch(e){console.warn('updateStats messages:',e);setStat('totalMessages',0);}
  var badge=document.getElementById('notifBadge');
  if(badge)badge.textContent=newOrders+newMessages;
};

/* ========== ربط أفاقي — التكامل المحاسبي ========== */
var afakyModeIds={api:'afakyFieldsApi',database:'afakyFieldsDatabase',csv:'afakyFieldsCsv',webhook:'afakyFieldsWebhook',email:'afakyFieldsEmail'};

window.toggleAfakyModeFields=function(){
  var mode=(document.getElementById('afakyMode')||{}).value||'api';
  Object.keys(afakyModeIds).forEach(function(m){
    var box=document.getElementById(afakyModeIds[m]);
    if(box)box.style.display=(m===mode)?'block':'none';
  });
};

function afakyUpdateStatusUI(s){
  var badge=document.getElementById('afakyStatus'),note=document.getElementById('afakyStatusNote');
  var enabled=!!(s&&s.enabled);
  var modeNames={api:'API مباشر',database:'قاعدة بيانات SQL Server',csv:'ملفات CSV',webhook:'Webhook',email:'البريد الإلكتروني'};
  if(badge){
    badge.textContent=enabled?'🟢 مفعل':'⚪ غير مفعل';
    badge.classList.toggle('active',enabled);
  }
  if(note){
    note.textContent=enabled
      ?'الربط مفعل حالياً بوضع: '+(modeNames[s.mode]||s.mode||'—')+' — البيانات جاهزة للتبادل مع نظام أفاقي.'
      :'لم يتم تفعيل الربط بعد — اضبط الإعدادات بالأسفل ثم احفظ.';
  }
}

function afakyFillForm(s){
  s=s||{};
  var setV=function(id,v){var el=document.getElementById(id);if(el)el.value=v==null?'':v;};
  var en=document.getElementById('afakyEnabled');if(en)en.checked=!!s.enabled;
  setV('afakyMode',s.mode||'api');
  setV('afakyApiKey',s.apiKey);setV('afakyApiUrl',s.apiUrl);
  setV('afakySqlServer',s.sqlServer);setV('afakySqlDatabase',s.sqlDatabase);
  setV('afakySqlUser',s.sqlUser);setV('afakySqlPassword',s.sqlPassword);
  setV('afakyWebhookUrl',s.webhookUrl);
  setV('afakyEmail',s.email);
  toggleAfakyModeFields();
}

window.loadAfakySettings=async function(){
  var s=null;
  try{
    var{data}=await supabaseClient.from('site_settings').select('settings').eq('id',1).maybeSingle();
    s=data&&data.settings?data.settings.afaky_settings:null;
    if(typeof s==='string'){try{s=JSON.parse(s);}catch(_){s=null;}}
  }catch(e){console.warn('loadAfakySettings:',e);}
  afakyFillForm(s||{});
  afakyUpdateStatusUI(s||{});
};

window.saveAfakySettings=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var getV=function(id){var el=document.getElementById(id);return el?el.value.trim():'';};
  var settings={
    enabled:!!(document.getElementById('afakyEnabled')||{}).checked,
    mode:getV('afakyMode')||'api',
    apiKey:getV('afakyApiKey'),
    apiUrl:getV('afakyApiUrl'),
    sqlServer:getV('afakySqlServer'),
    sqlDatabase:getV('afakySqlDatabase'),
    sqlUser:getV('afakySqlUser'),
    sqlPassword:getV('afakySqlPassword'),
    webhookUrl:getV('afakyWebhookUrl'),
    email:getV('afakyEmail')
  };
  try{
    var{data}=await supabaseClient.from('site_settings').select('settings').eq('id',1).maybeSingle();
    var all=(data&&data.settings)||{};
    all.afaky_settings=settings;
    var{error}=await supabaseClient.from('site_settings').upsert([{id:1,settings:all}]);
    if(error){adminToast('❌ خطأ: '+error.message,'error');return false;}
    afakyUpdateStatusUI(settings);
    adminToast('✅ تم حفظ إعدادات ربط أفاقي');
    logAudit('حفظ إعدادات أفاقي','الوضع: '+settings.mode);
    if(settings.mode==='email'){
      if(settings.email){
        try{
          window.open('mailto:'+settings.email+'?subject='+encodeURIComponent('تقرير أفاقي — درة فارس الشمال')+'&body='+encodeURIComponent('مرحباً،%0Aمرفق تقارير CSV المُصدّرة من لوحة إدارة الموقع.'));
        }catch(_){}
      }
      adminToast('📧 وضع البريد مفعل — أرفق ملفات CSV المُصدّرة في رسالة البريد لإرسال تقارير تلقائية إلى أفاقي');
    }
  }catch(err){
    console.warn('saveAfakySettings:',err);
    adminToast('❌ تعذر حفظ الإعدادات','error');
  }
  return false;
};

/* ========== أدوات CSV لربط أفاقي ========== */
function afakyCsvCell(v){
  v=(v===null||v===undefined)?'':String(v);
  return '"'+v.replace(/"/g,'""')+'"';
}
function afakyDateStamp(){
  var d=new Date();
  var p=function(n){return (n<10?'0':'')+n;};
  return ''+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate());
}
function afakyDownloadCSV(filename,headers,rows){
  var lines=[headers.map(afakyCsvCell).join(',')];
  rows.forEach(function(r){lines.push(r.map(afakyCsvCell).join(','));});
  var blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  var link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function(){URL.revokeObjectURL(link.href);},1000);
}

window.exportProductsCSV=async function(){
  try{
    var{data,error}=await supabaseClient.from('store_products').select('id,name,category,price,old_price,stock,description').order('id');
    if(error){adminToast('❌ خطأ: '+error.message,'error');return;}
    if(!data||!data.length){adminToast('📦 لا توجد منتجات للتصدير');return;}
    var rows=data.map(function(p){return [p.id,p.name,p.category,p.price,p.old_price,p.stock,p.description];});
    afakyDownloadCSV('products-afaky-'+afakyDateStamp()+'.csv',['id','name','category','price','old_price','stock','description'],rows);
    adminToast('✅ تم تصدير '+rows.length+' منتج');
    logAudit('تصدير CSV','تصدير '+rows.length+' منتج لنظام أفاقي');
  }catch(e){console.warn('exportProductsCSV:',e);adminToast('❌ تعذر تصدير المنتجات','error');}
};

window.exportOrdersCSV=async function(){
  try{
    var{data,error}=await supabaseClient.from('store_orders').select('order_number,customer_name,customer_phone,total,status,created_at').order('created_at',{ascending:false});
    if(error){adminToast('❌ خطأ: '+error.message,'error');return;}
    if(!data||!data.length){adminToast('🛒 لا توجد طلبات للتصدير');return;}
    var rows=data.map(function(o){return [o.order_number,o.customer_name,o.customer_phone,o.total,o.status,o.created_at];});
    afakyDownloadCSV('orders-afaky-'+afakyDateStamp()+'.csv',['order_number','customer_name','customer_phone','total','status','created_at'],rows);
    adminToast('✅ تم تصدير '+rows.length+' طلب');
    logAudit('تصدير CSV','تصدير '+rows.length+' طلب لنظام أفاقي');
  }catch(e){console.warn('exportOrdersCSV:',e);adminToast('❌ تعذر تصدير الطلبات','error');}
};

function afakyParseCSV(text){
  text=String(text||'').replace(/^\uFEFF/,'');
  var rows=[],row=[],cell='',inQ=false,i,ch;
  for(i=0;i<text.length;i++){
    ch=text[i];
    if(inQ){
      if(ch==='"'){
        if(text[i+1]==='"'){cell+='"';i++;}
        else inQ=false;
      }else cell+=ch;
    }else{
      if(ch==='"')inQ=true;
      else if(ch===','){row.push(cell);cell='';}
      else if(ch==='\n'||ch==='\r'){
        if(ch==='\r'&&text[i+1]==='\n')i++;
        row.push(cell);cell='';
        if(row.length>1||row[0]!=='')rows.push(row);
        row=[];
      }else cell+=ch;
    }
  }
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  return rows;
}

window.previewAfakyImport=function(input){
  var preview=document.getElementById('afakyImportPreview');
  var btn=document.getElementById('afakyImportBtn');
  adminState.afakyImport=[];
  if(!input||!input.files||!input.files[0]){
    if(preview)preview.style.display='none';
    if(btn)btn.style.display='none';
    return;
  }
  var reader=new FileReader();
  reader.onload=function(){
    try{
      var rows=afakyParseCSV(reader.result);
      if(rows.length<2){
        if(preview){preview.style.display='block';preview.textContent='⚠️ الملف فارغ أو بدون صفوف بيانات.';}
        if(btn)btn.style.display='none';
        return;
      }
      var header=rows[0].map(function(h){return String(h).trim().toLowerCase();});
      var products=[];
      for(var i=1;i<rows.length;i++){
        var r=rows[i],p={};
        header.forEach(function(col,idx){p[col]=r[idx]!==undefined?String(r[idx]).trim():'';});
        if(!p.id||isNaN(parseInt(p.id)))continue;
        products.push({
          id:parseInt(p.id),
          name:p.name||'',
          category:p.category||'',
          price:parseFloat(p.price)||0,
          old_price:p.old_price!==''?(parseFloat(p.old_price)||null):null,
          stock:parseInt(p.stock)||0,
          description:p.description||''
        });
      }
      adminState.afakyImport=products;
      var skipped=(rows.length-1)-products.length;
      if(preview){
        preview.style.display='block';
        preview.textContent='📋 معاينة: تم العثور على '+(rows.length-1)+' صف في الملف — '+products.length+' منتج جاهز للاستيراد'+(skipped>0?' ('+skipped+' صف تم تجاوزه لعدم وجود id صالح)':'')+'.';
      }
      if(btn)btn.style.display=products.length?'inline-block':'none';
    }catch(err){
      console.warn('previewAfakyImport:',err);
      if(preview){preview.style.display='block';preview.textContent='❌ تعذر قراءة الملف — تأكد أنه CSV صالح.';}
      if(btn)btn.style.display='none';
    }
  };
  reader.readAsText(input.files[0],'UTF-8');
};

window.runAfakyImport=async function(){
  var products=adminState.afakyImport||[];
  if(!products.length){adminToast('⚠️ لا توجد بيانات للاستيراد — اختر ملف CSV أولاً');return;}
  if(!confirm('سيتم استيراد/تحديث '+products.length+' منتج في المتجر. متابعة؟'))return;
  try{
    var{error}=await supabaseClient.from('store_products').upsert(products,{onConflict:'id'});
    if(error){adminToast('❌ خطأ: '+error.message,'error');return;}
    adminToast('✅ تم استيراد '+products.length+' منتج بنجاح');
    logAudit('استيراد CSV','استيراد/تحديث '+products.length+' منتج من ملف CSV');
    var preview=document.getElementById('afakyImportPreview');
    if(preview)preview.textContent='✅ اكتمل الاستيراد: '+products.length+' منتج.';
    var btn=document.getElementById('afakyImportBtn');if(btn)btn.style.display='none';
    var file=document.getElementById('afakyImportFile');if(file)file.value='';
    adminState.afakyImport=[];
    if(typeof loadProducts==='function')loadProducts();
  }catch(e){console.warn('runAfakyImport:',e);adminToast('❌ تعذر تنفيذ الاستيراد','error');}
};

/* ========== لوحة المؤشرات — رسوم Chart.js ========== */
var dashCharts={sales:null,status:null};
var dashChartDefaultsDone=false;
var CHARTJS_CDN='https://cdn.jsdelivr.net/npm/chart.js@4';

function dashShowEmpty(emptyId,boxId,show){
  var emptyEl=document.getElementById(emptyId),box=document.getElementById(boxId);
  if(emptyEl)emptyEl.style.display=show?'block':'none';
  if(box)box.style.display=show?'none':'block';
}

window.renderDashboardCharts=async function(){
  if(!document.getElementById('chartSalesWeek')||!document.getElementById('chartOrdersStatus'))return;
  try{
    await loadAdminScript(CHARTJS_CDN,'Chart');
  }catch(e){
    console.warn('renderDashboardCharts CDN:',e);
    dashShowEmpty('chartSalesWeekEmpty','chartSalesWeekBox',true);
    dashShowEmpty('chartOrdersStatusEmpty','chartOrdersStatusBox',true);
    return;
  }
  if(!dashChartDefaultsDone&&window.Chart){
    Chart.defaults.font.family="'Tajawal','Cairo',sans-serif";
    Chart.defaults.color='#94a3b8';
    dashChartDefaultsDone=true;
  }

  /* أ) أعمدة: مبيعات آخر 7 أيام */
  try{
    var since=new Date();since.setHours(0,0,0,0);since.setDate(since.getDate()-6);
    var res=await supabaseClient.from('store_orders').select('total,created_at').gte('created_at',since.toISOString());
    if(res.error)throw res.error;
    var weekOrders=res.data||[];
    if(!weekOrders.length)throw new Error('empty');
    var dayNames=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    var labels=[],sums=[];
    for(var i=0;i<7;i++){
      var d=new Date(since);d.setDate(since.getDate()+i);
      labels.push(dayNames[d.getDay()]);sums.push(0);
    }
    weekOrders.forEach(function(o){
      var dt=new Date(o.created_at);dt.setHours(0,0,0,0);
      var idx=Math.round((dt.getTime()-since.getTime())/86400000);
      if(idx>=0&&idx<7)sums[idx]+=Number(o.total||0);
    });
    if(dashCharts.sales){dashCharts.sales.destroy();dashCharts.sales=null;}
    dashShowEmpty('chartSalesWeekEmpty','chartSalesWeekBox',false);
    dashCharts.sales=new Chart(document.getElementById('chartSalesWeek').getContext('2d'),{
      type:'bar',
      data:{labels:labels,datasets:[{label:'المبيعات (ر.س)',data:sums,backgroundColor:'rgba(14,165,233,0.45)',borderColor:'#0EA5E9',borderWidth:1,borderRadius:8}]},
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{rtl:true,labels:{font:{family:"'Tajawal','Cairo',sans-serif"}}},
          tooltip:{rtl:true,textDirection:'rtl'}
        },
        scales:{
          x:{reverse:true,grid:{color:'rgba(255,255,255,0.05)'}},
          y:{beginAtZero:true,grid:{color:'rgba(255,255,255,0.05)'},ticks:{callback:function(v){return Number(v).toLocaleString('ar-SA');}}}
        }
      }
    });
  }catch(e){
    console.warn('renderDashboardCharts sales:',e);
    if(dashCharts.sales){dashCharts.sales.destroy();dashCharts.sales=null;}
    dashShowEmpty('chartSalesWeekEmpty','chartSalesWeekBox',true);
  }

  /* ب) دائري: توزيع الطلبات حسب الحالة */
  try{
    var res2=await supabaseClient.from('store_orders').select('status');
    if(res2.error)throw res2.error;
    var allOrders=res2.data||[];
    if(!allOrders.length)throw new Error('empty');
    var counts={};
    allOrders.forEach(function(o){var st=o.status||'new';counts[st]=(counts[st]||0)+1;});
    var stKeys=Object.keys(counts);
    var stLabels=stKeys.map(function(k){return orderStatuses[k]||k;});
    var stData=stKeys.map(function(k){return counts[k];});
    var palette=['#0EA5E9','#10B981','#F59E0B','#8B5CF6','#22D3EE','#34D399','#EF4444'];
    if(dashCharts.status){dashCharts.status.destroy();dashCharts.status=null;}
    dashShowEmpty('chartOrdersStatusEmpty','chartOrdersStatusBox',false);
    dashCharts.status=new Chart(document.getElementById('chartOrdersStatus').getContext('2d'),{
      type:'doughnut',
      data:{labels:stLabels,datasets:[{data:stData,backgroundColor:stKeys.map(function(_,i){return palette[i%palette.length];}),borderColor:'rgba(15,12,41,0.8)',borderWidth:2}]},
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{rtl:true,position:'bottom',labels:{font:{family:"'Tajawal','Cairo',sans-serif"},padding:14}},
          tooltip:{rtl:true,textDirection:'rtl'}
        }
      }
    });
  }catch(e){
    console.warn('renderDashboardCharts status:',e);
    if(dashCharts.status){dashCharts.status.destroy();dashCharts.status=null;}
    dashShowEmpty('chartOrdersStatusEmpty','chartOrdersStatusBox',true);
  }
};

/* ========== سجل التدقيق — العرض ========== */
window.loadAuditLog=async function(){
  var c=document.getElementById('auditLogList');if(!c)return;
  c.innerHTML='<div class="admin-empty">⏳ جاري التحميل...</div>';
  try{
    var{data,error}=await supabaseClient.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    if(!data||!data.length){c.innerHTML='<div class="admin-empty">📋 لا توجد عمليات مسجلة بعد</div>';return;}
    var html='<table><thead><tr><th>#</th><th>الوقت</th><th>العملية</th><th>التفاصيل</th></tr></thead><tbody>';
    data.forEach(function(r,i){
      html+='<tr><td>'+(i+1)+'</td><td>'+dateAr(r.created_at)+'</td><td><strong>'+esc(r.action||'—')+'</strong></td><td>'+esc(r.details||'—')+'</td></tr>';
    });
    html+='</tbody></table>';
    c.innerHTML=html;
  }catch(e){
    console.warn('loadAuditLog:',e);
    c.innerHTML='<div class="admin-empty">📋 لا توجد بيانات — تأكد من تنفيذ جدول audit_logs في Supabase (ملف جداول-اللوحة-المتقدمة.sql)</div>';
  }
};

/* ========== الفوترة الإلكترونية ZATCA — توليد QR بصيغة TLV ========== */
window.buildZatcaTLV=function(seller,vat,timestamp,total,tax){
  var values=[seller,vat,timestamp,total,tax];
  var bytes=[];
  for(var i=0;i<values.length;i++){
    var enc=new TextEncoder().encode(String(values[i]==null?'':values[i]));
    bytes.push(i+1,enc.length);
    for(var j=0;j<enc.length;j++)bytes.push(enc[j]);
  }
  var bin='';
  for(var k=0;k<bytes.length;k++)bin+=String.fromCharCode(bytes[k]);
  return btoa(bin);
};

window.loadZatcaSettings=async function(){
  var seller=document.getElementById('zatcaSellerName'),vat=document.getElementById('zatcaVatNumber');
  if(!seller||!vat)return;
  try{
    var{data}=await supabaseClient.from('site_settings').select('settings').eq('id',1).maybeSingle();
    var z=data&&data.settings?data.settings.zatca_settings:null;
    if(typeof z==='string'){try{z=JSON.parse(z);}catch(_){z=null;}}
    seller.value=(z&&z.sellerName)||'شركة درة فارس الشمال للتجارة';
    vat.value=(z&&z.vatNumber)||'';
  }catch(e){
    console.warn('loadZatcaSettings:',e);
    if(!seller.value)seller.value='شركة درة فارس الشمال للتجارة';
  }
};

window.saveZatcaSettings=async function(){
  var seller=(document.getElementById('zatcaSellerName')||{}).value||'';
  var vat=(document.getElementById('zatcaVatNumber')||{}).value||'';
  try{
    var{data}=await supabaseClient.from('site_settings').select('settings').eq('id',1).maybeSingle();
    var all=(data&&data.settings)||{};
    all.zatca_settings={sellerName:seller.trim()||'شركة درة فارس الشمال للتجارة',vatNumber:vat.trim()};
    var{error}=await supabaseClient.from('site_settings').upsert([{id:1,settings:all}]);
    if(error){adminToast('❌ خطأ: '+error.message,'error');return;}
    adminToast('✅ تم حفظ إعدادات الفوترة الإلكترونية');
    logAudit('حفظ إعدادات الفوترة','الرقم الضريبي: '+(vat.trim()||'غير محدد'));
  }catch(e){
    console.warn('saveZatcaSettings:',e);
    adminToast('❌ تعذر حفظ الإعدادات','error');
  }
};

window.loadZatcaInvoices=async function(){
  var c=document.getElementById('zatcaInvoicesTable');if(!c)return;
  c.innerHTML='<tr><td colspan="7">⏳ جاري التحميل...</td></tr>';
  try{
    var{data,error}=await supabaseClient.from('invoices').select('invoice_number,customer_name,total,tax,created_at').order('created_at',{ascending:false}).limit(50);
    if(error)throw error;
    if(!data||!data.length){c.innerHTML='<tr><td colspan="7">🧾 لا توجد فواتير</td></tr>';adminState.zatcaInvoices=[];return;}
    adminState.zatcaInvoices=data;
    c.innerHTML=data.map(function(inv,i){
      return '<tr><td>'+(i+1)+'</td><td><strong>'+esc(inv.invoice_number||'—')+'</strong></td><td>'+esc(inv.customer_name||'—')+'</td><td>'+money(inv.total)+'</td><td>'+money(inv.tax)+'</td><td>'+dateAr(inv.created_at)+'</td><td><button class="btn-edit" onclick="generateZatcaQR('+i+')">🔳 توليد QR</button></td></tr>';
    }).join('');
  }catch(e){
    console.warn('loadZatcaInvoices:',e);
    c.innerHTML='<tr><td colspan="7">🧾 لا توجد بيانات — تعذر تحميل الفواتير من جدول invoices</td></tr>';
  }
};

window.generateZatcaQR=async function(idx){
  var inv=(adminState.zatcaInvoices||[])[idx];
  if(!inv)return;
  var seller=((document.getElementById('zatcaSellerName')||{}).value||'').trim()||'شركة درة فارس الشمال للتجارة';
  var vat=((document.getElementById('zatcaVatNumber')||{}).value||'').trim();
  var ts=inv.created_at?new Date(inv.created_at).toISOString():new Date().toISOString();
  var total=Number(inv.total||0).toFixed(2);
  var tax=Number(inv.tax||0).toFixed(2);
  var tlv=buildZatcaTLV(seller,vat,ts,total,tax);
  var img=document.getElementById('zatcaQrImage');
  try{
    await loadAdminScript('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js','QRCode');
    if(img)img.src=await QRCode.toDataURL(tlv,{width:280,margin:2});
  }catch(e){
    console.warn('generateZatcaQR image:',e);
    if(img)img.removeAttribute('src');
    adminToast('⚠️ تعذر توليد صورة QR — يمكنك نسخ نص Base64 بالأسفل','error');
  }
  var b64=document.getElementById('zatcaQrBase64');if(b64)b64.value=tlv;
  var modal=document.getElementById('zatcaQrModal');if(modal)modal.classList.add('show');
  try{
    supabaseClient.from('zatca_logs').insert([{invoice_number:String(inv.invoice_number||''),total:Number(total),tax:Number(tax),qr_code:tlv}]).then(function(){},function(){});
  }catch(_){}
  logAudit('توليد QR زاتكا','فاتورة: '+(inv.invoice_number||'—')+' — إجمالي: '+total+' ر.س');
};

window.closeZatcaQrModal=function(){
  var modal=document.getElementById('zatcaQrModal');if(modal)modal.classList.remove('show');
};

window.copyZatcaQr=function(){
  var b64=document.getElementById('zatcaQrBase64');
  if(!b64||!b64.value){adminToast('⚠️ لا يوجد نص للنسخ');return;}
  var done=function(){adminToast('✅ تم نسخ Base64');};
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(b64.value).then(done,function(){b64.select();document.execCommand('copy');done();});
  }else{
    b64.select();document.execCommand('copy');done();
  }
};

/* ========== مزامنة أفاقي + سجل المزامنة ========== */
function afakyLogSync(entry){
  try{
    supabaseClient.from('afaky_sync_logs').insert([entry]).then(function(){loadAfakySyncLog();},function(){});
  }catch(_){}
}

window.syncAfakyNow=async function(){
  var s=null;
  try{
    var{data}=await supabaseClient.from('site_settings').select('settings').eq('id',1).maybeSingle();
    s=data&&data.settings?data.settings.afaky_settings:null;
    if(typeof s==='string'){try{s=JSON.parse(s);}catch(_){s=null;}}
  }catch(e){console.warn('syncAfakyNow settings:',e);}
  s=s||{};
  var mode=s.mode||'api';

  if(mode==='webhook'){
    if(!s.enabled||!s.webhookUrl){
      adminToast('⚠️ فعّل الربط واحفظ رابط Webhook من الإعدادات أولاً','error');
      return;
    }
    adminToast('⏳ جاري إرسال آخر 20 طلب إلى Webhook...');
    try{
      var{data:orders,error}=await supabaseClient.from('store_orders').select('*').order('created_at',{ascending:false}).limit(20);
      if(error)throw error;
      var controller=new AbortController();
      var timer=setTimeout(function(){controller.abort();},15000);
      var res=await fetch(s.webhookUrl,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({source:'dorat-fares-alshamal-admin',exported_at:new Date().toISOString(),orders:orders||[]}),
        signal:controller.signal
      });
      clearTimeout(timer);
      if(!res.ok)throw new Error('استجابة غير ناجحة: HTTP '+res.status);
      afakyLogSync({mode:'webhook',direction:'export',records_count:(orders||[]).length,status:'success',message:'تم إرسال '+(orders||[]).length+' طلب إلى رابط Webhook بنجاح'});
      logAudit('مزامنة أفاقي','webhook — تصدير '+(orders||[]).length+' طلب');
      adminToast('✅ تمت المزامنة: تم إرسال '+(orders||[]).length+' طلب');
    }catch(e){
      var msg=(e&&e.name==='AbortError')?'انتهت مهلة الاتصال (15 ثانية) — تعذر الوصول للرابط':('فشل الإرسال: '+((e&&e.message)||e));
      afakyLogSync({mode:'webhook',direction:'export',records_count:0,status:'failed',message:msg});
      logAudit('مزامنة أفاقي فاشلة',msg);
      adminToast('❌ '+msg,'error');
    }
    return;
  }

  if(mode==='csv'){
    exportOrdersCSV();
    afakyLogSync({mode:'csv',direction:'export',records_count:0,status:'success',message:'تم تشغيل تصدير الطلبات CSV من أدوات أفاقي'});
    logAudit('مزامنة أفاقي','csv — تصدير الطلبات');
    return;
  }

  if(mode==='email'){
    afakyLogSync({mode:'email',direction:'export',records_count:0,status:'success',message:'تم فتح رسالة بريد لإرسال التقارير إلى أفاقي'});
    if(s.email){
      try{
        window.open('mailto:'+s.email+'?subject='+encodeURIComponent('تقرير أفاقي — درة فارس الشمال')+'&body='+encodeURIComponent('مرحباً،%0Aمرفق تقارير CSV المُصدّرة من لوحة إدارة الموقع.'));
      }catch(_){}
      adminToast('📧 فتحنا رسالة بريد — أرفق ملفات CSV المُصدّرة ثم أرسلها');
    }else{
      adminToast('⚠️ احفظ بريد أفاقي المستلم من الإعدادات أولاً','error');
    }
    return;
  }

  var modeName=mode==='api'?'API مباشر':'قاعدة بيانات SQL Server';
  afakyLogSync({mode:mode,direction:'export',records_count:0,status:'failed',message:'المزامنة المباشرة من المتصفح غير مدعومة لوضع '+modeName+' — استخدم CSV أو Webhook'});
  adminToast('ℹ️ وضع '+modeName+' يحتاج وسيطاً خادمياً — بدّل الوضع إلى CSV أو Webhook للمزامنة الفورية','error');
};

window.loadAfakySyncLog=async function(){
  var c=document.getElementById('afakySyncLogList');if(!c)return;
  try{
    var{data,error}=await supabaseClient.from('afaky_sync_logs').select('*').order('created_at',{ascending:false}).limit(20);
    if(error)throw error;
    if(!data||!data.length){c.innerHTML='<div class="admin-empty">🔄 لا توجد عمليات مزامنة بعد</div>';return;}
    var dirNames={export:'تصدير ⬆️',import:'استيراد ⬇️'};
    var html='<table><thead><tr><th>#</th><th>الوقت</th><th>الوضع</th><th>الاتجاه</th><th>السجلات</th><th>الحالة</th><th>الرسالة</th></tr></thead><tbody>';
    data.forEach(function(r,i){
      var ok=r.status==='success';
      html+='<tr><td>'+(i+1)+'</td><td>'+dateAr(r.created_at)+'</td><td>'+esc(r.mode||'—')+'</td><td>'+esc(dirNames[r.direction]||r.direction||'—')+'</td><td>'+(r.records_count==null?'—':r.records_count)+'</td><td>'+(ok?'<span class="sync-status-ok">✅ نجاح</span>':'<span class="sync-status-fail">❌ فشل</span>')+'</td><td>'+esc(r.message||'—')+'</td></tr>';
    });
    html+='</tbody></table>';
    c.innerHTML=html;
  }catch(e){
    console.warn('loadAfakySyncLog:',e);
    c.innerHTML='<div class="admin-empty">🔄 لا توجد بيانات — تأكد من تنفيذ جدول afaky_sync_logs في Supabase</div>';
  }
};

/* ========== 💳 بوابات الدفع — محمية بجلسة Supabase Auth (RLS: authenticated فقط) ========== */
var GATEWAYS_AUTH_MSG='🔒 بوابات الدفع تتطلب الدخول بحساب الأدمن (إيميل + باسورد) — أنشئ المستخدم من Supabase Authentication ثم سجل دخول به';

function maskSecret(s){
  s=String(s||'');
  if(!s)return '';
  return '●●●●'+esc(s.slice(-4));
}

function gatewayCardHtml(g){
  var code=String(g.gateway_code||'');
  var name=String(g.gateway_name||code);
  var active=!!g.is_active;
  var live=g.mode==='live';
  var masked=maskSecret(g.secret_key)||(g.secret_key_enc?'●●●● 🔒 مشفّر':'');
  var h='<div class="gateway-card">';
  h+='<div class="gateway-card-head">';
  h+='<div><div class="gateway-name">'+esc(name)+'</div><div class="gateway-code">'+esc(code)+'</div></div>';
  h+='<div class="gateway-badges">';
  h+='<span class="gw-badge '+(active?'on':'off')+'">'+(active?'🟢 مفعّلة':'⚪ معطّلة')+'</span>';
  h+='<span class="gw-badge '+(live?'live':'test')+'">'+(live?'🔴 Live':'🧪 Test')+'</span>';
  h+='</div></div>';
  h+='<div class="gateway-actions">';
  h+='<button class="btn-edit" onclick="toggleGatewayForm(\''+esc(code)+'\')">⚙️ إعدادات</button>';
  h+='<button class="btn-edit" onclick="toggleGatewayActive(\''+esc(code)+'\')">'+(active?'⛔ تعطيل':'✅ تفعيل')+'</button>';
  h+='</div>';
  h+='<div class="gateway-form" id="gwForm-'+esc(code)+'" style="display:none">';
  h+='<div class="form-group"><label>Publishable Key</label><input type="text" id="gw-pub-'+esc(code)+'" value="'+esc(g.publishable_key||'')+'" dir="ltr" style="text-align:left" placeholder="pk_..."></div>';
  h+='<div class="form-group"><label>Secret Key '+(masked?'<span class="gw-masked-hint">المحفوظ: '+masked+' — اترك الحقل فارغاً للإبقاء على القديم</span>':'')+'</label>';
  h+='<div class="gw-secret-wrap"><input type="password" id="gw-secret-'+esc(code)+'" dir="ltr" style="text-align:left" placeholder="'+(masked||'sk_...')+'" autocomplete="new-password">';
  h+='<button type="button" class="gw-eye" title="إظهار/إخفاء" onclick="toggleGwSecret(\''+esc(code)+'\',this)">👁</button></div></div>';
  h+='<div class="form-group"><label>Webhook Secret</label><input type="text" id="gw-webhook-'+esc(code)+'" value="'+esc(g.webhook_secret||'')+'" dir="ltr" style="text-align:left" placeholder="whsec_..."></div>';
  if(code==='hyperpay'){
    h+='<div class="form-group"><label>Entity ID</label><input type="text" id="gw-entity-'+esc(code)+'" value="'+esc(g.entity_id||'')+'" dir="ltr" style="text-align:left" placeholder="8a829..."></div>';
  }
  h+='<div class="form-group"><label>وضع التشغيل</label><select id="gw-mode-'+esc(code)+'" onchange="onGatewayModeChange(\''+esc(code)+'\')">';
  h+='<option value="test"'+(live?'':' selected')+'>🧪 Test — تجريبي</option>';
  h+='<option value="live"'+(live?' selected':'')+'>🔴 Live — حقيقي</option>';
  h+='</select></div>';
  h+='<div class="gw-live-warning" id="gw-livewarn-'+esc(code)+'"'+(live?'':' style="display:none"')+'>⚠️ وضع Live = أموال حقيقية — تأكد من المفاتيح</div>';
  h+='<button class="btn-save" onclick="saveGateway(\''+esc(code)+'\')">💾 حفظ إعدادات '+esc(name)+'</button>';
  h+='</div></div>';
  return h;
}

window.loadPaymentGateways=async function(){
  var c=document.getElementById('gatewaysList');if(!c)return;
  try{
    if(!(await hasAuthSession())){c.innerHTML='<div class="gateway-auth-note">'+GATEWAYS_AUTH_MSG+'</div>';return;}
    c.innerHTML='<div class="admin-empty">⏳ جاري التحميل...</div>';
    var{data,error}=await supabaseClient.from('payment_gateways').select('*').order('gateway_code');
    if(error)throw error;
    adminState.gateways=data||[];
    if(!data||!data.length){c.innerHTML='<div class="admin-empty">💳 لا توجد بوابات — نفّذ جدول payment_gateways في Supabase</div>';return;}
    c.innerHTML=data.map(function(g){return gatewayCardHtml(g);}).join('');
  }catch(e){
    console.warn('loadPaymentGateways:',e);
    c.innerHTML='<div class="gateway-auth-note">'+GATEWAYS_AUTH_MSG+'<div class="gw-err-detail">'+esc((e&&e.message)||String(e))+'</div></div>';
  }
};

window.toggleGatewayForm=function(code){
  var f=document.getElementById('gwForm-'+code);if(!f)return;
  f.style.display=(f.style.display==='none'||!f.style.display)?'block':'none';
};

window.toggleGwSecret=function(code,btn){
  var i=document.getElementById('gw-secret-'+code);if(!i)return;
  i.type=(i.type==='password')?'text':'password';
  if(btn)btn.classList.toggle('on',i.type==='text');
};

window.onGatewayModeChange=function(code){
  var m=document.getElementById('gw-mode-'+code),w=document.getElementById('gw-livewarn-'+code);
  if(m&&w)w.style.display=(m.value==='live')?'block':'none';
};

window.toggleGatewayActive=async function(code){
  try{
    if(!(await hasAuthSession())){adminToast(GATEWAYS_AUTH_MSG,'error');return;}
    var g=(adminState.gateways||[]).find(function(x){return String(x.gateway_code)===String(code);});
    if(!g){adminToast('⚠️ البوابة غير موجودة — حدّث القائمة','error');return;}
    var next=!g.is_active;
    var{error}=await supabaseClient.from('payment_gateways').update({is_active:next}).eq('gateway_code',code);
    if(error)throw error;
    adminToast(next?'✅ تم تفعيل البوابة':'⛔ تم تعطيل البوابة');
    logAudit(next?'تفعيل بوابة دفع':'تعطيل بوابة دفع',String(g.gateway_name||code));
    loadPaymentGateways();
  }catch(e){
    console.warn('toggleGatewayActive:',e);
    adminToast('❌ تعذر التحديث: '+((e&&e.message)||e),'error');
  }
};

window.saveGateway=async function(code){
  try{
    if(!(await hasAuthSession())){adminToast(GATEWAYS_AUTH_MSG,'error');return;}
    var secret=formVal('gw-secret-'+code);
    if(secret){
      /* مفتاح سري جديد ← يُرسل عبر فانكشن manage-gateway (تشفير AES-256-GCM + تحقق أدمن)
         ولا يُحفظ نصاً صريحاً في الجدول أبداً */
      var sr=await supabaseClient.auth.getSession();
      var token=sr&&sr.data&&sr.data.session?sr.data.session.access_token:null;
      if(!token){adminToast('❌ لا توجد جلسة دخول — سجّل دخولك من جديد','error');return;}
      var g=(adminState.gateways||[]).find(function(x){return String(x.gateway_code)===String(code);});
      var payload={
        gateway_code:String(code),
        gateway_name:g?String(g.gateway_name||code):String(code),
        publishable_key:formVal('gw-pub-'+code),
        webhook_secret:formVal('gw-webhook-'+code),
        mode:formVal('gw-mode-'+code)||'test',
        secret_key:secret
      };
      if(String(code)==='hyperpay')payload.entity_id=formVal('gw-entity-'+code);
      var res=await fetch('https://kcbmvxuzjlaooknwhqqb.supabase.co/functions/v1/manage-gateway',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body:JSON.stringify(payload)
      });
      var data=await res.json().catch(function(){return null;});
      if(res.status===403){adminToast('❌ تحتاج صلاحية أدمن','error');return;}
      if(res.status===401){adminToast('❌ جلسة الدخول غير صالحة — سجّل دخولك من جديد','error');return;}
      if(data&&data.error==='MASTER_KEY_MISSING'){adminToast('⚠️ مفتاح التشفير غير مضبوط — أضف GATEWAY_MASTER_KEY في Supabase (Project Settings ← Edge Functions ← Secrets)','error');return;}
      if(!res.ok||!data||!data.ok){adminToast('❌ تعذر حفظ البوابة: '+((data&&data.error)||('HTTP '+res.status)),'error');return;}
      adminToast('✅ تم حفظ إعدادات البوابة — المفتاح السري محفوظ مشفّراً 🔒');
      logAudit('حفظ إعدادات بوابة دفع',String(code)+' — وضع: '+payload.mode+' — مفتاح سري مشفّر');
      loadPaymentGateways();
      return;
    }
    /* الحقل السري فارغ = لا تغيير عليه ← تحديث الحقول غير السرية مباشرة كالمعتاد */
    var rec={
      publishable_key:formVal('gw-pub-'+code),
      webhook_secret:formVal('gw-webhook-'+code),
      mode:formVal('gw-mode-'+code)||'test'
    };
    if(String(code)==='hyperpay')rec.entity_id=formVal('gw-entity-'+code);
    var{error}=await supabaseClient.from('payment_gateways').update(rec).eq('gateway_code',code);
    if(error)throw error;
    adminToast('✅ تم حفظ إعدادات البوابة');
    logAudit('حفظ إعدادات بوابة دفع',String(code)+' — وضع: '+rec.mode);
    loadPaymentGateways();
  }catch(e){
    console.warn('saveGateway:',e);
    adminToast('❌ تعذر الحفظ: '+((e&&e.message)||e),'error');
  }
};

document.addEventListener('DOMContentLoaded',async function(){
  /* استعادة الجلسة: supabaseClient.auth.getSession() فقط — لا جلسة = صفحة الدخول بدون أي استثناء */
  if(await hasAuthSession()){openAdminPanel();return;}
  /* تنظيف صامت لمفاتيح localStorage القديمة (adminLoggedIn/adminLoginTime) — لا تفتح اللوحة أبداً */
  try{
    localStorage.removeItem('adminLoggedIn');
    localStorage.removeItem('adminLoginTime');
  }catch(_){}
});

})();


/* ============================================================
   👥 إدارة الموظفين — الأدمن يضيف إيميلات، وكل موظف يعيّن كلمته بنفسه
   ============================================================ */
async function loadStaff(){
  var c=document.getElementById('staffList'); if(!c)return;
  c.innerHTML='<div class="admin-empty">⏳ جاري التحميل...</div>';
  var{data,error}=await supabaseClient.from('staff_members').select('*').order('created_at',{ascending:false});
  if(error){ c.innerHTML='<div class="admin-empty">👥 تعذر التحميل — تأكد من تشغيل ملف نظام-الموظفين-والأدمن.sql في Supabase أولاً.</div>'; return; }
  if(!data||!data.length){ c.innerHTML='<div class="admin-empty">👥 لا يوجد موظفون بعد — أضف أول إيميل من الأعلى.</div>'; return; }
  c.innerHTML='<table><thead><tr><th>الإيميل</th><th>الحالة</th><th>أُضيف في</th><th>فعّل حسابه في</th><th>إجراءات</th></tr></thead><tbody>'+data.map(function(s){
    var badge=s.status==='active'
      ?'<span style="background:rgba(16,185,129,.15);color:#10B981;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">✅ نشط — عيّن كلمته</span>'
      :'<span style="background:rgba(245,158,11,.15);color:#F59E0B;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">⏳ بانتظار أول دخول</span>';
    return '<tr><td style="direction:ltr;text-align:right;font-weight:700">'+s.email+'</td><td>'+badge+'</td><td>'+new Date(s.created_at).toLocaleDateString('ar-EG')+'</td><td>'+(s.activated_at?new Date(s.activated_at).toLocaleDateString('ar-EG'):'—')+'</td><td><button class="btn-delete" onclick="deleteStaff('+s.id+',\''+String(s.email).replace(/'/g,"")+'\')">🗑️ حذف</button></td></tr>';
  }).join('')+'</tbody></table>';
}

window.addStaff=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var inp=document.getElementById('newStaffEmail');
  var email=(inp.value||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){adminToast('⚠️ أدخل إيميلاً صحيحاً','error');return false;}
  var{data:{user}}=await supabaseClient.auth.getUser();
  var{error}=await supabaseClient.from('staff_members').insert([{email:email,invited_by:user?user.id:null}]);
  if(error){adminToast('❌ '+(error.code==='23505'?'هذا الإيميل مضاف مسبقاً':error.message),'error');return false;}
  inp.value='';
  adminToast('✅ تمت إضافة الموظف — أخبره أن ينشئ حساباً من الموقع بنفس الإيميل ويختار كلمته الخاصة');
  loadStaff();
  return false;
};

window.deleteStaff=async function(id,email){
  if(!confirm('حذف الموظف "'+email+'"؟ لن يستطيع الدخول للوحة بعد الآن (حسابه على الموقع يبقى عميلاً عادياً).'))return;
  var{error}=await supabaseClient.from('staff_members').delete().eq('id',id);
  if(error){adminToast('❌ '+error.message,'error');return;}
  adminToast('✅ تم حذف الموظف');
  loadStaff();
};

/* ============================================================
   🔑 تغيير كلمة المرور — كل مستخدم يغيّر كلمته بنفسه فقط
   ============================================================ */
window.changeMyPassword=async function(e){
  if(e&&e.preventDefault)e.preventDefault();
  var p1=document.getElementById('myNewPassword').value;
  var p2=document.getElementById('myNewPassword2').value;
  if(p1.length<6){adminToast('⚠️ كلمة المرور 6 أحرف على الأقل','error');return false;}
  if(p1!==p2){adminToast('⚠️ كلمتا المرور غير متطابقتين','error');return false;}
  var{error}=await supabaseClient.auth.updateUser({password:p1});
  if(error){adminToast('❌ '+error.message,'error');return false;}
  document.getElementById('myNewPassword').value='';
  document.getElementById('myNewPassword2').value='';
  adminToast('✅ تم تغيير كلمة المرور بنجاح — استخدمها من تسجيل الدخول القادم');
  logAudit('تغيير كلمة مرور','غيّر مستخدم اللوحة كلمة مروره الخاصة');
  return false;
};


/* ============================================================
   📥 استيراد مخزون آفاق — قراءة Excel «أرصدة الأصناف»
   صيغة الملف: عمود واحد مفصول بفاصلة عربية «؛»
   من اليمين: الفرع؛الكود؛اسم الصنف؛(فارغ)؛الوحدة؛الكمية؛المخزن؛...
   الاستيراد بدون أسعار — الأصناف الجديدة تُزرع مخفية بسعر 0
   ============================================================ */
window._afaqXlsItems = null;

window.afaqGuessCategory = function(name){
  var s = (name||'').toUpperCase();
  if (/TONER|INK|حبر|أحبار/.test(s)) return 'ink';
  if (/CABLE|CABEL|كيبل|كابل|وصل|CONVERT|تحويلة|HDMI|VGA/.test(s)) return 'cables';
  if (/RAM/.test(s)) return 'ram';
  if (/HDD|SSD|HARD|هارد|تخزين/.test(s)) return 'storage';
  if (/PROJECTOR|بروجكتر|بروجيكتر/.test(s)) return 'projectors';
  if (/PRINTER|طابع/.test(s)) return 'printers';
  if (/MONITOR|LAPTOP|PC\b|كمبيوتر|شاشة|CASE HARD PC/.test(s)) return 'computers';
  return 'accessories';
};

window.afaqParseSheet = function(lines){
  var items = [], neg = 0, skipped = 0;
  lines.forEach(function(raw){
    var v = (raw == null ? '' : String(raw));
    if (!v.trim()) return;
    var p = v.split(/[؛;]/);
    if (p.length < 3) { skipped++; return; }
    var code = (p[p.length-2] || '').trim();
    var name = (p[p.length-3] || '').trim();
    var qtyRaw = p.length >= 6 ? (p[p.length-6] || '').trim() : '';
    var unit = p.length >= 5 ? (p[p.length-5] || '').trim() : '';
    var qty = parseFloat(qtyRaw);
    if (!code || !name || !isFinite(qty)) { skipped++; return; }
    var stock = Math.max(0, Math.round(qty));
    if (qty < 0) neg++;
    items.push({sku: code, name: name, stock: stock, unit: unit, negative: qty < 0});
  });
  // إزالة أي تكرار بالكود — آخر ظهور يغلب
  var seen = {}, out = [];
  items.forEach(function(it){ seen[it.sku] = it; });
  Object.keys(seen).forEach(function(k){ out.push(seen[k]); });
  return {items: out, negativeCount: neg, skippedRows: skipped};
};

// الوضع الثاني: ملف Excel بأعمدة حقيقية — نبحث عن صف الترويسة (الكود/اسم الصنف/الكمية)
window.afaqParseTable = function(rows){
  var hi = -1, map = {};
  for (var i = 0; i < Math.min(rows.length, 30); i++) {
    var cells = (rows[i] || []).map(function(c){ return String(c == null ? '' : c).trim(); });
    var ci = cells.findIndex(function(c){ return c === 'الكود' || c.indexOf('الكود') === 0; });
    var ni = cells.findIndex(function(c){ return c === 'اسم الصنف' || c.indexOf('اسم الصنف') === 0; });
    var qi = cells.findIndex(function(c){ return c === 'الكمية' || c.indexOf('الكمية') === 0; });
    var ui = cells.findIndex(function(c){ return c === 'الوحدة'; });
    if (ci > -1 && ni > -1 && qi > -1) { hi = i; map = {code: ci, name: ni, qty: qi, unit: ui}; break; }
  }
  if (hi < 0) return null;
  var items = [], neg = 0, skipped = 0;
  for (var r = hi + 1; r < rows.length; r++) {
    var row = rows[r] || [];
    var code = String(row[map.code] == null ? '' : row[map.code]).trim();
    var name = String(row[map.name] == null ? '' : row[map.name]).trim();
    var qty = parseFloat(String(row[map.qty] == null ? '' : row[map.qty]).replace(/,/g, ''));
    var unit = map.unit > -1 ? String(row[map.unit] == null ? '' : row[map.unit]).trim() : '';
    if (!code && !name) { skipped++; continue; }
    if (!code || !name || !isFinite(qty)) { skipped++; continue; }
    var stock = Math.max(0, Math.round(qty));
    if (qty < 0) neg++;
    items.push({sku: code, name: name, stock: stock, unit: unit, negative: qty < 0});
  }
  var seen = {}, out = [];
  items.forEach(function(it){ seen[it.sku] = it; });
  Object.keys(seen).forEach(function(k){ out.push(seen[k]); });
  return {items: out, negativeCount: neg, skippedRows: skipped};
};

window.afaqXlsPreview = function(input){
  var box = document.getElementById('afaqXlsPreviewBox');
  var btn = document.getElementById('afaqXlsImportBtn');
  window._afaqXlsItems = null;
  btn.style.display = 'none';
  var f = input.files && input.files[0];
  if (!f) return;
  if (typeof XLSX === 'undefined') { box.textContent = '❌ مكتبة قراءة Excel لم تُحمّل — تأكد من الاتصال بالإنترنت وأعد فتح اللوحة.'; return; }
  box.textContent = '⏳ جاري قراءة الملف: ' + f.name + ' ...';
  var reader = new FileReader();
  reader.onload = function(ev){
    try {
      var buf = new Uint8Array(ev.target.result);
      var rows = [];
      if (/\.csv$/i.test(f.name) || f.type === 'text/csv') {
        // ملف CSV من آفاق — فك الترميز: UTF-8 أولاً ثم Windows-1256 للعربي القديم
        var text = new TextDecoder('utf-8').decode(buf);
        if (text.indexOf('\uFFFD') > -1) text = new TextDecoder('windows-1256').decode(buf);
        rows = text.split(/\r?\n/).map(function(line){ return [line]; });
      } else {
        var wb = XLSX.read(buf, {type:'array'});
        var ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:''});
      }
      // المحاولة 1: صيغة العمود الواحد المفصول بـ«؛» أو «;»
      var lines = rows.map(function(r){ return (r && r.length ? r[0] : ''); });
      var res = afaqParseSheet(lines);
      // المحاولة 2: جدول أعمدة حقيقية بترويسة الكود/اسم الصنف/الكمية
      if (!res.items.length) {
        var res2 = afaqParseTable(rows);
        if (res2 && res2.items.length) res = res2;
      }
      window._afaqXlsItems = res.items;
      if (!res.items.length) {
        var dbg = rows.slice(0, 6).map(function(r){ return (r || []).join(' | ').slice(0, 90); }).join('\n');
        box.innerHTML = '⚠️ لم يتم العثور على أصناف صالحة في الملف (عدد الصفوف المقروءة: ' + rows.length + ').<br>أول صفوف الملف كما قرأتها الأداة — ابعتها لي لو استمرت المشكلة:<pre style="direction:ltr;text-align:left;font-size:11px;background:rgba(0,0,0,.25);padding:10px;border-radius:8px;white-space:pre-wrap">' + dbg.replace(/</g,'&lt;') + '</pre>';
        return;
      }
      var html = '📋 تم قراءة <b>' + res.items.length + '</b> صنف بنجاح' +
        (res.negativeCount ? ' — ' + res.negativeCount + ' صنف بكمية سالبة ستُزرع بمخزون 0' : '') +
        (res.skippedRows ? ' — تم تجاوز ' + res.skippedRows + ' صف (ترويسة/تذييل/غير صالح)' : '') + '.';
      html += '<div style="max-height:220px;overflow:auto;margin-top:10px;border:1px solid rgba(255,255,255,.08);border-radius:10px"><table style="width:100%;font-size:12px"><thead><tr><th>الكود</th><th>اسم الصنف</th><th>الكمية</th><th>التصنيف المتوقع</th></tr></thead><tbody>';
      res.items.slice(0, 15).forEach(function(it){
        html += '<tr><td>' + it.sku + '</td><td>' + it.name.replace(/</g,'&lt;') + '</td><td>' + it.stock + (it.negative?' ⚠️':'') + '</td><td>' + afaqGuessCategory(it.name) + '</td></tr>';
      });
      if (res.items.length > 15) html += '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">… و' + (res.items.length - 15) + ' صنف آخر</td></tr>';
      html += '</tbody></table></div>';
      box.innerHTML = html;
      btn.style.display = '';
    } catch(e) {
      console.warn('afaqXlsPreview:', e);
      box.textContent = '❌ تعذّر قراءة الملف — تأكد أنه ملف Excel سليم (.xlsx).';
    }
  };
  reader.readAsArrayBuffer(f);
};

window.afaqXlsRun = async function(){
  var items = window._afaqXlsItems;
  if (!items || !items.length) { adminToast('⚠️ اختر ملف آفاق أولاً وانتظر المعاينة', 'error'); return; }
  var hideNew = document.getElementById('afaqHideNew').checked;
  var autoCat = document.getElementById('afaqAutoCat').checked;
  if (!confirm('سيتم استيراد ' + items.length + ' صنف من آفاق إلى قاعدة بيانات الموقع.\n• الأصناف الجديدة: بدون أسعار' + (hideNew ? ' ومخفية عن المتجر' : '') + '\n• الأصناف الموجودة: تحديث الكمية فقط (السعر والصورة لا يُمسّان)\nمتابعة؟')) return;
  var btn = document.getElementById('afaqXlsImportBtn');
  var box = document.getElementById('afaqXlsPreviewBox');
  btn.disabled = true; btn.textContent = '⏳ جاري الاستيراد...';
  try {
    // جلب المنتجات الموجودة لمطابقة الكود (sku)
    var existing = [];
    var from = 0;
    while (true) {
      var q = await supabaseClient.from('store_products').select('id,sku,stock').range(from, from + 999);
      if (q.error) throw q.error;
      existing = existing.concat(q.data || []);
      if (!q.data || q.data.length < 1000) break;
      from += 1000;
    }
    var bySku = {};
    existing.forEach(function(p){ if (p.sku != null && p.sku !== '') bySku[String(p.sku).trim()] = p; });

    var toInsert = [], toUpdate = [];
    items.forEach(function(it){
      if (bySku[it.sku]) {
        toUpdate.push({id: bySku[it.sku].id, sku: it.sku, stock: it.stock});
      } else {
        toInsert.push({
          name: it.name,
          sku: it.sku,
          price: 0,
          old_price: null,
          stock: it.stock,
          category: autoCat ? afaqGuessCategory(it.name) : 'accessories',
          badge: 'تحت التسعير',
          image: '',
          description: 'مستورد من نظام آفاق — وحدة: ' + (it.unit || 'PCS'),
          rating: 0,
          is_active: !hideNew
        });
      }
    });

    var inserted = 0, updated = 0, failed = 0;
    for (var i = 0; i < toInsert.length; i += 100) {
      var r1 = await supabaseClient.from('store_products').insert(toInsert.slice(i, i + 100));
      if (r1.error) { console.warn('insert chunk:', r1.error); failed += Math.min(100, toInsert.length - i); }
      else inserted += Math.min(100, toInsert.length - i);
    }
    for (var j = 0; j < toUpdate.length; j += 100) {
      var r2 = await supabaseClient.from('store_products').upsert(toUpdate.slice(j, j + 100), {onConflict: 'id'});
      if (r2.error) { console.warn('update chunk:', r2.error); failed += Math.min(100, toUpdate.length - j); }
      else updated += Math.min(100, toUpdate.length - j);
    }

    var msg = '✅ اكتمل استيراد آفاق: ' + inserted + ' صنف جديد + ' + updated + ' تحديث كمية' + (failed ? ' — ⚠️ فشل ' + failed : '');
    adminToast(msg, failed ? 'error' : 'success');
    logAudit('استيراد مخزون آفاق', 'Excel أرصدة الأصناف: ' + inserted + ' جديد / ' + updated + ' تحديث كمية / بدون أسعار');
    box.innerHTML = msg + '<br><span style="color:var(--text-muted);font-size:12px">الخطوة التالية: افتح صفحة «المنتجات» وسعّر الأصناف الجديدة ثم فعّلها لتظهر في المتجر.</span>';
    window._afaqXlsItems = null;
    btn.style.display = 'none';
    if (typeof loadProducts === 'function') loadProducts();
  } catch(e) {
    console.warn('afaqXlsRun:', e);
    adminToast('❌ تعذّر الاستيراد: ' + (e.message || e), 'error');
  }
  btn.disabled = false; btn.textContent = '⬆️ تنفيذ الاستيراد الآن';
};


/* ============================================================
   🏛️ المحاسبة — قيود اليومية + ميزان المراجعة + قائمة الدخل
   كل البيانات مشتقة من erp_journal_lines (لا تعديل يدوي)
   ============================================================ */
window.erpPostUnposted = async function(){
  if (!confirm('سيتم إنشاء قيد يومية لكل طلب بيع غير مرحّل (مدين: العملاء / دائن: المبيعات).\nالعملية آمنة ولن تكرر أي قيد موجود. متابعة؟')) return;
  adminToast('⏳ جاري الترحيل...');
  var r = await supabaseClient.rpc('erp_post_unposted_orders');
  if (r.error) {
    console.warn('erpPostUnposted:', r.error);
    adminToast('❌ تعذّر الترحيل: ' + r.error.message + ' — تأكد من تشغيل ملف erp-phase1.sql في SQL Editor أولاً', 'error');
    return;
  }
  adminToast('✅ تم ترحيل ' + r.data + ' قيد جديد');
  logAudit('ترحيل محاسبي', 'إنشاء ' + r.data + ' قيد يومية من طلبات البيع');
  loadErpJournal(); loadErpTrialBalance(); loadErpIncome();
};

window.loadErpJournal = async function(){
  var t = document.getElementById('erpJournalTable');
  if (!t) return;
  var r = await supabaseClient.from('erp_journal_entries')
    .select('entry_number, created_at, memo, erp_journal_lines(debit, credit, party, erp_accounts(code, name))')
    .order('entry_number', {ascending: false}).limit(100);
  if (r.error) { t.innerHTML = '<tr><td colspan="7">⚠️ ' + (r.error.message.includes('does not exist') ? 'شغّل ملف erp-phase1.sql في SQL Editor أولاً' : r.error.message) + '</td></tr>'; return; }
  if (!r.data || !r.data.length) { t.innerHTML = '<tr><td colspan="7">📒 لا توجد قيود بعد — اضغط «ترحيل الطلبات غير المرحّلة» لإنشائها من طلبات البيع</td></tr>'; return; }
  var rows = [];
  r.data.forEach(function(e){
    (e.erp_journal_lines || []).forEach(function(l){
      rows.push('<tr><td>' + e.entry_number + '</td><td>' + new Date(e.created_at).toLocaleDateString('ar-EG') + '</td><td>' + (e.memo || '') + '</td><td>' + (l.erp_accounts ? l.erp_accounts.code + ' — ' + l.erp_accounts.name : '') + '</td><td>' + (l.party || '—') + '</td><td>' + (Number(l.debit) ? Number(l.debit).toLocaleString() : '') + '</td><td>' + (Number(l.credit) ? Number(l.credit).toLocaleString() : '') + '</td></tr>');
    });
  });
  t.innerHTML = rows.join('');
};

window.loadErpTrialBalance = async function(){
  var t = document.getElementById('erpTrialTable');
  if (!t) return;
  var r = await supabaseClient.from('erp_v_trial_balance').select('*');
  if (r.error || !r.data || !r.data.length) { t.innerHTML = '<tr><td colspan="6">' + (r.error && !r.error.message.includes('does not exist') ? r.error.message : 'لا توجد حركات بعد') + '</td></tr>'; return; }
  t.innerHTML = r.data.map(function(a){
    var bal = Number(a.balance || 0);
    return '<tr><td>' + a.code + '</td><td>' + a.name + '</td><td>' + a.kind + '</td><td>' + Number(a.total_debit || 0).toLocaleString() + '</td><td>' + Number(a.total_credit || 0).toLocaleString() + '</td><td style="font-weight:700;color:' + (bal >= 0 ? '#22C55E' : '#EF4444') + '">' + bal.toLocaleString() + '</td></tr>';
  }).join('');
};

window.loadErpIncome = async function(){
  var t = document.getElementById('erpIncomeTable');
  if (!t) return;
  var r = await supabaseClient.from('erp_v_income_statement').select('*');
  if (r.error || !r.data || !r.data.length) { t.innerHTML = '<tr><td colspan="2">لا توجد بيانات بعد</td></tr>'; return; }
  t.innerHTML = r.data.map(function(x, i){
    var last = i === r.data.length - 1;
    return '<tr' + (last ? ' style="font-weight:800;background:rgba(34,197,94,.08)"' : '') + '><td>' + x.line + '</td><td>' + Number(x.amount || 0).toLocaleString() + ' ر.س</td></tr>';
  }).join('');
};
