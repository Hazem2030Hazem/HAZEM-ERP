/* HAZEM.ERP — استرجاع النسخة المستقرة مع التحقق من بيانات إنشاء الحساب */
document.write('<script src="https://cdn.jsdelivr.net/gh/Hazem2030Hazem/HAZEM-ERP@d523777879303ab86b2e031814eb3995f9c974b4/app.js"><\/script>');
window.addEventListener('DOMContentLoaded', () => {
  const button = document.querySelector('#btn-signup');
  if (!button) return;
  button.addEventListener('click', (event) => {
    const email = document.querySelector('#auth-email').value.trim();
    const password = document.querySelector('#auth-password').value;
    let message = '';
    if (!email || !password) message = 'اكتب البريد الإلكتروني وكلمة المرور أولاً';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) message = 'اكتب بريداً إلكترونياً صحيحاً';
    else if (password.length < 6) message = 'كلمة المرور يجب ألا تقل عن 6 أحرف';
    if (!message) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toast(message, false);
  }, true);
});
