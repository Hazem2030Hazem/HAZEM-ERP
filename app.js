/* HAZEM.ERP — النسخة المستقرة مع صفحة تسجيل العميل والمؤسسة */
document.write('<style>.modal-overlay{z-index:1000!important}</style>');
document.write('<script src="https://cdn.jsdelivr.net/gh/Hazem2030Hazem/HAZEM-ERP@d523777879303ab86b2e031814eb3995f9c974b4/app.js"><\/script>');
window.addEventListener('DOMContentLoaded', () => {
  const button = document.querySelector('#btn-signup');
  if (!button) return;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    location.href = 'signup.html';
  }, true);
});
