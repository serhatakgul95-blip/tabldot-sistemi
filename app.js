const APP_KEY = 'personel_yasam_v6';
const LEGACY_APP_KEYS = [];

const seed = {
  users: [], mealSelections: {}, expenses: [], payments: [], debts: [], leaveRequests: [], leavePreferences: [],
  leavePlanResults: [], laundry: [], attendance: [], auditLogs: [],
  settings: {
    systemName: 'GençServi',
    iban: 'TR00 0000 0000 0000 0000 0000 00',
    accountName: 'Ortak Tabldot Hesabı',
    weeklyLaundryLimit: 2,
    leavePlanYear: 2027,
    maxConcurrentLeave: 2
  }
};

let db = loadDB();
let cloudSyncChain = Promise.resolve();
let firebaseBooted = false;
let currentUser = null;
let currentPage = 'dashboard';
let leaveCalendarCursor = startOfMonth(new Date());
let mealWeekCursor = startOfWeek(new Date());
let mealManagementWeekCursor = startOfWeek(new Date());
let cookDateCursor = new Date();
let attendanceDateCursor = new Date();
let attendanceWeekCursor = startOfWeek(new Date());

const roleNames = { admin: 'Admin', manager: 'Müdür', staff: 'Personel', cook: 'Aşçı', administrative: 'İdari İşler', commander: 'Karakol Komutanı' };
const rolePermissions = {
  staff: [],
  cook: ['kitchen.view'],
  administrative: ['personnel.view','attendance.view','attendance.manage','leave.view','leave.manage','meal.manage','finance.manage','reports.view'],
  commander: ['personnel.view','attendance.view','leave.view','leave.approve','leave.plan','reports.view'],
  manager: ['personnel.view','attendance.view','attendance.manage','leave.view','leave.manage','leave.approve','leave.plan','meal.manage','finance.manage','reports.view','kitchen.view','laundry.manage'],
  admin: ['*']
};
const mealNames = { breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam' };
const mealStatusNames = { yes: 'Yiyecek', no: 'Yemeyecek', duty: 'Görevdeyim / Ayır', '': 'Tercih yok' };

function getNavItems() {
  const common = [
    ['dashboard', '⌂', 'Ana Sayfa'],
    ['my-meals', '🍽', 'Yemek Tercihim'],
    ['my-finance', '₺', 'Borç ve Ödemelerim'],
    ['my-leaves', '📅', 'İzinlerim'],
    ['leave-preference', '🗓', 'Yıllık İzin Tercihim'],
    ['laundry', '🧺', 'Çamaşır Randevusu'],
    ['profile', '👤', 'Profilim']
  ];
  if (hasPermission('kitchen.view')) common.splice(2, 0, ['cook-dashboard', '👨‍🍳', 'Aşçı Yemek Ekranı']);
  const management = [];
  if (hasPermission('personnel.view')) management.push(['members', '👥', 'Personel Listesi']);
  if (hasPermission('attendance.manage')) management.push(['attendance-management', '📝', 'Yoklama Girişi']);
  if (hasPermission('attendance.view')) management.push(['attendance-overview', '📋', 'Yoklama Özeti']);
  if (hasPermission('meal.manage')) management.push(['meal-management', '🍲', 'Yemek Yönetimi']);
  if (hasPermission('finance.manage')) management.push(['finance-management', '🏦', 'Ödeme ve Bilanço']);
  if (hasPermission('leave.view')) management.push(['leave-management', '🧭', 'İzin Yönetimi']);
  if (hasPermission('leave.plan')) management.push(['leave-planning', '⭐', 'İzin Planlaması']);
  if (hasPermission('reports.view')) management.push(['reports', '📊', 'Raporlar']);
  if (isAdmin()) management.push(['settings', '⚙', 'Sistem Ayarları']);
  return [...common, ...management];
}
function createEmptyDB() {
  return {
    users: [], mealSelections: {}, expenses: [], payments: [], debts: [], leaveRequests: [], leavePreferences: [],
    leavePlanResults: [], laundry: [], attendance: [], auditLogs: [], settings: { ...seed.settings, systemName: 'GençServi' }
  };
}
function loadDB() {
  try {
    const stored = JSON.parse(localStorage.getItem(APP_KEY));
    if (stored) return ensureV6Data(stored);
  } catch (_) {}
  return createEmptyDB();
}
function ensureV6Data(data) {
  data ||= createEmptyDB();
  data.users ||= [];
  data.mealSelections ||= {};
  data.expenses ||= [];
  data.payments ||= [];
  data.debts ||= [];
  data.leaveRequests ||= [];
  data.leavePreferences ||= [];
  data.leavePlanResults ||= [];
  data.laundry ||= [];
  data.attendance ||= [];
  data.auditLogs ||= [];
  data.settings = { ...seed.settings, systemName: 'GençServi', ...(data.settings || {}) };
  const roleMap = { admin: ['staff','admin'], manager: ['staff','manager'], staff: ['staff'], cook: ['staff','cook'], administrative: ['staff','administrative'], commander: ['staff','commander'] };
  data.users.forEach(u => {
    u.roles = Array.isArray(u.roles) && u.roles.length ? u.roles : (roleMap[u.role] || ['staff']);
    u.extraPermissions ||= [];
    u.approved = Boolean(u.approved);
    u.rejected = Boolean(u.rejected);
    delete u.password;
  });
  return data;
}
function setCloudStatus(state, text) {
  const el = document.getElementById('cloudStatus');
  if (!el) return;
  el.classList.remove('online','offline');
  if (state) el.classList.add(state);
  const label = el.querySelector('span:last-child');
  if (label) label.textContent = text;
}
function applyCloudState(nextState, rerender = true) {
  db = ensureV6Data(nextState);
  localStorage.setItem(APP_KEY, JSON.stringify(db));
  const authUid = window.FirebaseBridge?.currentAuthUser()?.uid;
  if (authUid) {
    const fresh = db.users.find(u => u.uid === authUid);
    if (fresh) currentUser = fresh;
  }
  if (rerender && currentUser) {
    renderNav();
    renderPage();
  }
}
function saveDB() {
  localStorage.setItem(APP_KEY, JSON.stringify(db));
  if (!firebaseBooted || !currentUser || !window.FirebaseBridge) return;
  const snapshot = structuredClone(db);
  setCloudStatus('', 'Senkronize ediliyor');
  cloudSyncChain = cloudSyncChain
    .then(() => window.FirebaseBridge.saveState(snapshot))
    .then(() => setCloudStatus('online', 'Firestore bağlı'))
    .catch(error => {
      console.error(error);
      setCloudStatus('offline', 'Senkron hatası');
      toast(window.FirebaseBridge.errorMessage(error));
    });
}
function normalizePhone(value) { let d = String(value || '').replace(/\D/g, ''); if (d.startsWith('90') && d.length === 12) d = '0' + d.slice(2); if (d.length === 10 && d.startsWith('5')) d = '0' + d; return d; }
function money(value) { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(value || 0)); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[s])); }
function pad(value) { return String(value).padStart(2, '0'); }
function toISO(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function parseISO(value) { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function addDays(date, amount) { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
function startOfWeek(date) { const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); next.setDate(next.getDate() - ((next.getDay() + 6) % 7)); return next; }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1, 12); }
function formatDate(value) { return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' }).format(parseISO(value)); }
function formatShortDate(value) { return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parseISO(value)); }
function formatDayDate(value) { return new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(parseISO(value)); }
function daysBetween(start, end) { return Math.max(1, Math.round((parseISO(end) - parseISO(start)) / 86400000) + 1); }
function initials(name) { return String(name).split(' ').map(x => x[0]).filter(Boolean).slice(0, 2).join('').toUpperCase(); }
function getUser(id) { return db.users.find(u => u.id === Number(id)); }
function userRoles(user = currentUser) { return user ? (Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role || 'staff']) : []; }
function hasRole(role, user = currentUser) { return userRoles(user).includes(role); }
function hasPermission(permission, user = currentUser) {
  if (!user) return false;
  const roles = userRoles(user);
  if (roles.includes('admin')) return true;
  const permissions = new Set(user.extraPermissions || []);
  roles.forEach(role => (rolePermissions[role] || []).forEach(p => permissions.add(p)));
  return permissions.has(permission);
}
function hasManagementPermission() { return currentUser && ['personnel.view','attendance.view','meal.manage','finance.manage','leave.view','leave.plan','reports.view'].some(hasPermission); }
function hasCookPermission() { return hasPermission('kitchen.view'); }
function isAdmin() { return hasRole('admin'); }
function userRoleLabels(user = currentUser) { return userRoles(user).map(r => roleNames[r] || r).join(' + '); }
function logAudit(action, details) { db.auditLogs ||= []; db.auditLogs.unshift({ id: Date.now() + Math.random(), at: new Date().toISOString(), userId: currentUser?.id || null, action, details }); db.auditLogs = db.auditLogs.slice(0, 500); }
function approvedUsers() { return db.users.filter(u => u.approved && !u.rejected); }
function planningUsers() { return approvedUsers(); }

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function showModal(title, body) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalBackdrop').classList.remove('hidden');
}
function closeModal() { document.getElementById('modalBackdrop').classList.add('hidden'); }
function statusBadge(status) {
  const map = {
    approved: ['success', 'Onaylandı'], pending: ['warning', 'Onay Bekliyor'], rejected: ['danger', 'Reddedildi'],
    report: ['danger', 'Sağlık İzni'], paid: ['success', 'Ödendi'], unpaid: ['danger', 'Ödenmedi'],
    submitted: ['info', 'Tercih Verildi'], unsubmitted: ['neutral', 'Tercih Yok'], allocated1: ['success', '1. Tercih'],
    allocated2: ['info', '2. Tercih'], waitlist: ['warning', 'Bekleme Listesi'], published: ['success', 'Takvime Aktarıldı']
  };
  const [cls, label] = map[status] || ['neutral', status || '—'];
  return `<span class="status ${cls}">${label}</span>`;
}
function metric(icon, label, value, sub) { return `<div class="card metric-card"><div class="metric-icon">${icon}</div><div><span>${label}</span><strong>${value}</strong><small>${sub}</small></div></div>`; }
function quick(icon, title, sub, action) { return `<button class="quick-item" onclick="${action}" style="width:100%;text-align:left"><div class="quick-item-main"><div class="metric-icon">${icon}</div><div><strong>${title}</strong><span>${sub}</span></div></div><b>›</b></button>`; }
function notice(title, sub) { return `<div class="quick-item"><div><strong>${title}</strong><span>${sub}</span></div></div>`; }

function firebaseReadyPromise() {
  if (window.FirebaseBridge?.ready) return Promise.resolve();
  return new Promise(resolve => window.addEventListener('firebase-ready', resolve, { once: true }));
}
async function bootFirebase() {
  try {
    await firebaseReadyPromise();
    firebaseBooted = true;
    setCloudStatus('', 'Firestore kontrol ediliyor');
    await window.FirebaseBridge.ensureSettings();
    const hasUsers = await window.FirebaseBridge.hasAnyUsers();
    document.getElementById('bootstrapBox').classList.toggle('hidden', hasUsers);
    const authUser = await window.FirebaseBridge.waitForAuthState();
    if (authUser) {
      const profile = await window.FirebaseBridge.getUserProfile(authUser.uid);
      if (profile?.approved && !profile?.rejected) await enterAuthenticatedApp(profile);
      else await window.FirebaseBridge.signOut();
    }
    setCloudStatus('online', 'Firestore bağlı');
  } catch (error) {
    console.error(error);
    setCloudStatus('offline', 'Firebase bağlantı hatası');
    toast(window.FirebaseBridge?.errorMessage(error) || 'Firebase bağlantısı kurulamadı.');
  }
}
async function enterAuthenticatedApp(profile) {
  setCloudStatus('', 'Veriler yükleniyor');
  const cloudState = await window.FirebaseBridge.loadState();
  applyCloudState(cloudState, false);
  const freshProfile = db.users.find(u => u.uid === profile.uid) || profile;
  if (!freshProfile.approved || freshProfile.rejected) {
    await window.FirebaseBridge.signOut();
    throw new Error(freshProfile.rejected ? 'Üyelik başvurunuz reddedildi.' : 'Üyeliğiniz henüz onaylanmadı.');
  }
  login(freshProfile);
  window.FirebaseBridge.startRealtime(nextState => applyCloudState(nextState, true));
  setCloudStatus('online', 'Firestore bağlı');
}
function openBootstrapModal() {
  showModal('İlk Admin Hesabını Oluştur', `<form id="bootstrapForm" class="form-grid">
    <label>Ad soyad<input name="name" required></label><label>Telefon<input name="phone" type="tel" required></label>
    <label class="span-2">Görev / rütbe<input name="title" value="Sistem Yöneticisi" required></label>
    <label class="span-2">Şifre<input name="password" type="password" minlength="6" required></label>
    <div class="span-2"><button class="btn btn-warning btn-block">İlk Admini Oluştur</button></div>
  </form>`);
  document.getElementById('bootstrapForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      setCloudStatus('', 'Admin oluşturuluyor');
      const profile = await window.FirebaseBridge.bootstrapAdmin({ name: f.get('name').trim(), phone: normalizePhone(f.get('phone')), title: f.get('title').trim(), password: f.get('password') });
      closeModal();
      document.getElementById('bootstrapBox').classList.add('hidden');
      await enterAuthenticatedApp(profile);
      toast('İlk admin hesabı oluşturuldu.');
    } catch (error) { toast(window.FirebaseBridge.errorMessage(error)); setCloudStatus('offline', 'Kurulum hatası'); }
  });
}
function init() {
  document.querySelectorAll('.auth-tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('loginForm').classList.toggle('hidden', btn.dataset.authTab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', btn.dataset.authTab !== 'register');
  }));
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const phone = normalizePhone(document.getElementById('loginPhone').value);
    const password = document.getElementById('loginPassword').value;
    try {
      setCloudStatus('', 'Giriş yapılıyor');
      const authUser = await window.FirebaseBridge.signIn(phone, password);
      const profile = await window.FirebaseBridge.getUserProfile(authUser.uid);
      if (!profile) { await window.FirebaseBridge.signOut(); return toast('Kullanıcı profili bulunamadı.'); }
      if (profile.rejected) { await window.FirebaseBridge.signOut(); return toast('Üyelik başvurunuz reddedilmiş.'); }
      if (!profile.approved) { await window.FirebaseBridge.signOut(); return toast('Üyeliğiniz henüz admin tarafından onaylanmadı.'); }
      await enterAuthenticatedApp(profile);
    } catch (error) { setCloudStatus('offline', 'Giriş başarısız'); toast(window.FirebaseBridge.errorMessage(error)); }
  });
  document.getElementById('registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const phone = normalizePhone(document.getElementById('registerPhone').value);
    try {
      setCloudStatus('', 'Kayıt oluşturuluyor');
      await window.FirebaseBridge.registerPending({
        name: document.getElementById('registerName').value.trim(), phone,
        title: document.getElementById('registerTitle').value.trim(),
        password: document.getElementById('registerPassword').value
      });
      e.target.reset();
      toast('Başvurunuz Firestore’a kaydedildi. Admin onayından sonra giriş yapabilirsiniz.');
      document.querySelector('[data-auth-tab="login"]').click();
      setCloudStatus('online', 'Firestore bağlı');
    } catch (error) { setCloudStatus('offline', 'Kayıt başarısız'); toast(window.FirebaseBridge.errorMessage(error)); }
  });
  document.getElementById('bootstrapBtn').addEventListener('click', openBootstrapModal);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
  document.getElementById('notificationBtn').addEventListener('click', () => toast('Bildirim merkezi sonraki aşamada SMS ve site içi bildirimlerle bağlanacak.'));
  document.getElementById('todayLabel').textContent = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
  bootFirebase();
}

function login(user) {
  currentUser = user;
  document.getElementById('authView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('sidebarName').textContent = user.name;
  document.getElementById('sidebarRole').textContent = userRoleLabels(user) + (hasManagementPermission() ? ' · Yetkili hesap' : hasCookPermission() ? ' · Mutfak görünümü aktif' : '');
  document.getElementById('sidebarAvatar').textContent = initials(user.name);
  document.getElementById('topAvatar').textContent = initials(user.name);
  currentPage = 'dashboard';
  renderNav();
  renderPage();
}
async function logout() {
  try { window.FirebaseBridge?.stopRealtime(); await window.FirebaseBridge?.signOut(); } catch (_) {}
  currentUser = null;
  document.getElementById('appView').classList.add('hidden');
  document.getElementById('authView').classList.remove('hidden');
  document.getElementById('loginForm').reset();
  setCloudStatus('online', 'Firestore bağlı');
}
function renderNav() {
  const nav = document.getElementById('mainNav');
  const items = getNavItems();
  nav.innerHTML = items.map(([id, icon, label]) => {
    const kitchenStart = id === 'cook-dashboard';
    const managementStart = ['members','attendance-management','attendance-overview','meal-management','finance-management','leave-management','leave-planning','reports','settings'].includes(id) && !items.slice(0, items.indexOf(items.find(x => x[0] === id))).some(x => ['members','attendance-management','attendance-overview','meal-management','finance-management','leave-management','leave-planning','reports','settings'].includes(x[0]));
    return `${kitchenStart ? '<div class="nav-section-label">Mutfak</div>' : ''}${managementStart ? '<div class="nav-section-label">Yönetim</div>' : ''}<button class="nav-item ${id === currentPage ? 'active' : ''}" data-page="${id}"><span class="nav-icon">${icon}</span>${label}</button>`;
  }).join('');
  nav.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
    currentPage = btn.dataset.page;
    document.getElementById('sidebar').classList.remove('open');
    renderNav();
    renderPage();
  }));
}
function renderPage() {
  const titles = Object.fromEntries(getNavItems().map(x => [x[0], x[2]]));
  document.getElementById('pageTitle').textContent = titles[currentPage] || 'Panel';
  const pages = {
    dashboard: renderDashboard,
    members: renderMembers,
    'my-meals': renderMyMeals,
    'meal-management': renderMealManagement,
    'cook-dashboard': renderCookDashboard,
    'attendance-management': renderAttendanceManagement,
    'attendance-overview': renderAttendanceOverview,
    'my-finance': renderMyFinance,
    'finance-management': renderFinanceManagement,
    'my-leaves': renderMyLeaves,
    'leave-management': renderLeaveManagement,
    'leave-preference': renderMyLeavePreference,
    'leave-planning': renderLeavePlanning,
    laundry: renderLaundry,
    reports: renderReports,
    settings: renderSettings,
    profile: renderProfile
  };
  (pages[currentPage] || renderDashboard)();
}
function goPage(page) { currentPage = page; renderNav(); renderPage(); }

function renderDashboard() {
  const ownDebt = db.debts.filter(x => x.userId === currentUser.id).reduce((s, x) => s + Math.max(0, x.amount - x.paid), 0);
  const approvedAnnual = db.leaveRequests.filter(x => x.userId === currentUser.id && x.type === 'Yıllık İzin' && x.status === 'approved').reduce((s, x) => s + x.days, 0);
  const remaining = Math.max(0, currentUser.annualAllowance - currentUser.usedLeave - approvedAnnual);
  const preference = db.leavePreferences.find(x => x.userId === currentUser.id && x.year === db.settings.leavePlanYear);
  const currentWeek = getWeekDates(mealWeekCursor);
  const mealCount = currentWeek.reduce((sum, date) => sum + mealDayReservedCount(getMealDay(currentUser.id, date)), 0);

  const personal = `
    <div class="grid grid-4">
      ${metric('🍽', 'Bu haftaki ayrılacak öğün', mealCount, 'Tarih bazlı tercihleriniz')}
      ${metric('₺', 'Güncel borcunuz', money(ownDebt), 'Ödeme bilgileri kendi ekranınızda')}
      ${metric('📅', 'Kullanılabilir yıllık izin', remaining + ' gün', 'Kullanılan: ' + currentUser.usedLeave + ' gün')}
      ${metric('⭐', db.settings.leavePlanYear + ' izin tercihi', preference ? 'Gönderildi' : 'Bekliyor', 'Planlama puanı: ' + (currentUser.planningScore ?? 0))}
    </div>
    <div class="grid grid-2 section-gap">
      <div class="card"><div class="card-header"><div><h3>Kişisel işlemlerim</h3><p>Müdür ve admin hesapları da buradan kendi işlemlerini yapar</p></div></div><div class="card-body quick-list">
        ${quick('🍽', 'Tarihli yemek listesini güncelle', 'Cuma 20.00 kısıtlaması kaldırıldı', "goPage('my-meals')")}
        ${hasCookPermission() ? quick('👨‍🍳', 'Bugünün yemek sayılarını aç', 'Kahvaltı, öğle ve akşam hazırlık sayıları', "goPage('cook-dashboard')") : ''}
        ${quick('📅', 'İzin talebi oluştur', 'Kendi izin kayıtlarınızı yönetin', "goPage('my-leaves')")}
        ${quick('⭐', 'Yıllık izin tercihlerini gönder', '1. ve 2. tercih alınır', "goPage('leave-preference')")}
      </div></div>
      <div class="card"><div class="card-header"><div><h3>Duyurular</h3><p>Ortak bilgilendirmeler</p></div></div><div class="card-body quick-list">
        ${notice('Yemek tercihleri', 'Hafta içinde herhangi bir zamanda güncellenebilir.')}
        ${notice('İzin planlaması', db.settings.leavePlanYear + ' yılı için iki tarih tercihi alınmaktadır.')}
        ${notice('Tek giriş noktası', 'Yetkili hesaplarda personel ve yönetim menüleri birlikte görünür.')}
      </div></div>
    </div>`;

  if (!hasManagementPermission()) {
    document.getElementById('pageContent').innerHTML = personal;
    return;
  }

  const pendingMembers = db.users.filter(u => !u.approved).length;
  const pendingLeaves = db.leaveRequests.filter(x => x.status === 'pending').length;
  const submitted = db.leavePreferences.filter(x => x.year === db.settings.leavePlanYear).length;
  document.getElementById('pageContent').innerHTML = personal + `
    <div class="management-banner section-gap"><strong>${userRoleLabels(currentUser)} yetkileri açık</strong><span>Aynı hesapla hem kendi personel işlemlerinizi hem de yönetim işlemlerini yapabilirsiniz.</span></div>
    <div class="grid grid-4 section-gap">
      ${metric('👥', 'Aktif personel', approvedUsers().length, pendingMembers + ' üyelik onay bekliyor')}
      ${metric('🕓', 'Bekleyen izin talebi', pendingLeaves, 'Değerlendirme gerekli')}
      ${metric('⭐', 'İzin tercihi veren', submitted + ' kişi', db.settings.leavePlanYear + ' planlama yılı')}
      ${metric('🍲', 'Yemek listesi', 'Tarihli', 'Öğün ve görev ayrımıyla')}
    </div>
    <div class="card section-gap"><div class="card-header"><div><h3>Yönetim kısa yolları</h3><p>Yetkinize bağlı ortak ekranlar</p></div></div><div class="card-body quick-list">
      ${quick('👥', 'Personel listesini aç', 'İzin geçmişi ve planlama puanları', "goPage('members')")}
      ${hasPermission('attendance.manage') ? quick('📝', 'Bugünkü yoklamayı gir', 'İzin, rapor, görev ve diğer durumlar', "goPage('attendance-management')") : ''}
      ${hasPermission('attendance.view') ? quick('📋', 'Günlük / haftalık yoklamayı gör', 'Mevcut ve mevcut olmayan personel özeti', "goPage('attendance-overview')") : ''}
      ${hasPermission('meal.manage') ? quick('🍲', 'Tarihli yemek durumunu incele', 'Gün ve öğün bazında toplamlar', "goPage('meal-management')") : ''}
      ${hasCookPermission() ? quick('👨‍🍳', 'Aşçı hazırlık ekranını aç', 'Bugünün net yemek ve paket sayıları', "goPage('cook-dashboard')") : ''}
      ${hasPermission('leave.plan') ? quick('⭐', 'Puanlı izin planını oluştur', 'Tercihler ve günlük kontenjan', "goPage('leave-planning')") : ''}
    </div></div>`;
}

function renderMembers() {
  if (!hasPermission('personnel.view')) return goPage('dashboard');
  const pending = db.users.filter(u => !u.approved && !u.rejected);
  const active = approvedUsers();
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-3">
      ${metric('👥', 'Toplam kayıt', db.users.length, 'Tüm kullanıcılar')}
      ${metric('✅', 'Aktif kullanıcı', active.length, 'Sisteme giriş yapabilir')}
      ${metric('🕓', 'Onay bekleyen', pending.length, isAdmin() ? 'Admin işlemi gerekli' : 'Müdür yalnızca görüntüler')}
    </div>
    <div class="card section-gap"><div class="card-header"><div><h3>Onay bekleyen üyelikler</h3><p>Tek giriş ekranından yapılan kayıtlar</p></div></div>
      ${pending.length ? `<div class="table-wrap"><table><thead><tr><th>Personel</th><th>Telefon</th><th>Görev</th><th>İşlem</th></tr></thead><tbody>${pending.map(u => `<tr><td><strong>${escapeHtml(u.name)}</strong></td><td>${u.phone}</td><td>${escapeHtml(u.title)}</td><td>${isAdmin() ? `<button class="btn btn-success btn-sm" onclick="approveMember(${u.id})">Onayla</button> <button class="btn btn-danger btn-sm" onclick="rejectMember(${u.id})">Reddet</button>` : 'Admin onayı bekleniyor'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Onay bekleyen üyelik bulunmuyor.</div>'}
    </div>
    <div class="card section-gap"><div class="card-header"><div><h3>Tüm aktif personeller</h3><p>Müdür kendi hesabıyla burada bütün personeli ve izin geçmişini görebilir</p></div>${isAdmin() ? '<button class="btn btn-primary btn-sm" onclick="newMemberModal()">Personel Ekle</button>' : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Ad soyad</th><th>Telefon</th><th>Rol</th><th>Görev</th><th>Kalan izin</th><th>Planlama puanı</th><th>İşlem</th></tr></thead><tbody>${active.map(u => `<tr><td><button class="person-link" onclick="openPersonnelLeaves(${u.id})">${escapeHtml(u.name)}</button></td><td>${u.phone}</td><td>${escapeHtml(userRoleLabels(u))}</td><td>${escapeHtml(u.title)}</td><td>${getRemainingLeave(u)} gün</td><td><strong>${u.planningScore ?? 0}</strong></td><td><button class="btn btn-secondary btn-sm" onclick="openPersonnelLeaves(${u.id})">İzinleri</button> ${isAdmin() ? `<button class="btn btn-secondary btn-sm" onclick="roleModal(${u.id})">Rol / Yetki</button>` : ''} ${hasPermission('leave.plan') ? `<button class="btn btn-primary btn-sm" onclick="planningScoreModal(${u.id})">Puanı Düzenle</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
}
function approveMember(id) { if (!isAdmin()) return; const u = getUser(id); if (u) { u.approved = true; u.rejected = false; saveDB(); renderMembers(); toast('Üyelik onaylandı.'); } }
function rejectMember(id) { if (!isAdmin()) return; const u = getUser(id); if (u) { u.approved = false; u.rejected = true; saveDB(); renderMembers(); toast('Başvuru reddedildi. Firebase Authentication hesabı güvenlik nedeniyle silinmedi.'); } }
function newMemberModal() {
  if (!isAdmin()) return;
  showModal('Yeni Personel Ekle', `<form id="newMemberForm" class="form-grid">
    <label>Ad soyad<input name="name" required></label><label>Telefon<input name="phone" required></label>
    <label>Görev / rütbe<input name="title" required></label><label>Rol<select name="role"><option value="staff">Personel</option><option value="cook">Aşçı</option><option value="manager">Müdür</option><option value="administrative">İdari İşler</option><option value="commander">Karakol Komutanı</option><option value="admin">Admin</option></select></label>
    <label>Yıllık izin hakkı<input name="annualAllowance" type="number" value="30" min="0"></label><label>Planlama puanı<input name="planningScore" type="number" value="50" min="0" max="1000"></label>
    <label class="span-2">Geçici şifre<input name="password" type="password" minlength="6" placeholder="En az 6 karakter" required></label>
    <div class="span-2"><button class="btn btn-primary btn-block">Personeli Kaydet</button></div></form>`);
  document.getElementById('newMemberForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const role = f.get('role');
    const profile = { id: Date.now(), name: f.get('name').trim(), phone: normalizePhone(f.get('phone')), title: f.get('title').trim(), role, roles: role === 'staff' ? ['staff'] : ['staff', role], extraPermissions: [], approved: true, rejected: false, annualAllowance: Number(f.get('annualAllowance')), usedLeave: 0, planningScore: Number(f.get('planningScore')), planningScoreNote: '' };
    try {
      await window.FirebaseBridge.adminCreateUser(profile, f.get('password'));
      closeModal(); await refreshFromCloud(false); renderMembers(); toast('Firebase Authentication hesabı ve personel kaydı oluşturuldu.');
    } catch (error) { toast(window.FirebaseBridge.errorMessage(error)); }
  });
}
function planningScoreModal(userId) {
  if (!hasPermission('leave.plan')) return;
  const user = getUser(userId); if (!user) return;
  showModal(`${user.name} · Planlama Puanı`, `<form id="scoreForm" class="form-grid">
    <label class="span-2">Puan<input name="score" type="number" min="0" max="1000" value="${user.planningScore ?? 0}" required></label>
    <label class="span-2">Puan açıklaması<textarea name="note" placeholder="Puanın hangi ölçütlerle verildiğini yazın">${escapeHtml(user.planningScoreNote || '')}</textarea></label>
    <div class="span-2"><button class="btn btn-primary btn-block">Puanı Kaydet</button></div></form>`);
  document.getElementById('scoreForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target);
    user.planningScore = Number(f.get('score')); user.planningScoreNote = f.get('note');
    db.leavePlanResults = [];
    saveDB(); closeModal();
    if (currentPage === 'leave-planning') renderLeavePlanning(); else renderMembers();
    toast('Planlama puanı güncellendi.');
  });
}


function roleModal(userId) {
  if (!isAdmin()) return;
  const user = getUser(userId); if (!user) return;
  const available = ['staff','cook','administrative','commander','manager','admin'];
  showModal(`${user.name} · Rol ve Yetki`, `<form id="roleForm">
    <p class="form-note">Bir kullanıcıya birden fazla rol verilebilir. Personel rolü temel kişisel işlemleri temsil eder.</p>
    <div class="role-check-grid section-gap">${available.map(role => `<label class="role-check"><input type="checkbox" name="roles" value="${role}" ${userRoles(user).includes(role) ? 'checked' : ''}><span><strong>${roleNames[role]}</strong><small>${(rolePermissions[role] || []).join(', ') || 'Temel personel işlevleri'}</small></span></label>`).join('')}</div>
    <button class="btn btn-primary btn-block section-gap">Rolleri Kaydet</button>
  </form>`);
  document.getElementById('roleForm').addEventListener('submit', e => {
    e.preventDefault();
    const roles = [...new FormData(e.target).getAll('roles')];
    if (!roles.length) roles.push('staff');
    user.roles = [...new Set(roles)];
    user.role = roles.includes('admin') ? 'admin' : roles.includes('commander') ? 'commander' : roles.includes('administrative') ? 'administrative' : roles.includes('manager') ? 'manager' : roles.includes('cook') ? 'cook' : 'staff';
    logAudit('role.update', `${user.name}: ${userRoleLabels(user)}`);
    saveDB(); closeModal(); renderMembers(); toast('Kullanıcının rolleri güncellendi.');
  });
}

const attendanceStatuses = {
  present: { label: 'Mevcut', short: 'M', icon: '✅' },
  annual_leave: { label: 'Yıllık İzin', short: 'İ', icon: '🏖️' },
  excuse_leave: { label: 'Mazeret İzni', short: 'Mİ', icon: '🗓️' },
  road_leave: { label: 'Yol İzni', short: 'Yİ', icon: '🛣️' },
  medical: { label: 'Raporlu / İstirahatli', short: 'R', icon: '🏥' },
  duty: { label: 'Görevli', short: 'G', icon: '🚗' },
  temporary_duty: { label: 'Geçici Görevli', short: 'GG', icon: '📍' },
  course: { label: 'Kurs / Eğitim', short: 'K', icon: '📚' },
  referral: { label: 'Sevkli', short: 'S', icon: '🏥' },
  rest: { label: 'Nöbet İstirahati', short: 'Nİ', icon: '🌙' },
  other: { label: 'Diğer', short: 'D', icon: '•' }
};
function attendanceStatusMeta(status) { return attendanceStatuses[status] || attendanceStatuses.other; }
function attendanceStatusFromLeave(req) {
  const text = `${req.type || ''}`.toLocaleLowerCase('tr-TR');
  if (text.includes('yıllık')) return 'annual_leave';
  if (text.includes('mazeret')) return 'excuse_leave';
  if (text.includes('yol')) return 'road_leave';
  if (text.includes('sağlık') || req.status === 'report') return 'medical';
  return 'other';
}
function attendanceForUserDate(userId, date) {
  const manual = (db.attendance || []).filter(x => x.userId === Number(userId) && x.start <= date && x.end >= date).sort((a,b) => b.id - a.id)[0];
  if (manual) return { status: manual.status, note: manual.note || '', source: 'manual', record: manual };
  const leave = (db.leaveRequests || []).find(x => x.userId === Number(userId) && ['approved','report'].includes(x.status) && x.start <= date && x.end >= date);
  if (leave) return { status: attendanceStatusFromLeave(leave), note: leave.type, source: 'leave', record: leave };
  return { status: 'present', note: '', source: 'default', record: null };
}
function dailyAttendanceStats(date) {
  const stats = { total: 0, present: 0 };
  approvedUsers().forEach(user => { const a = attendanceForUserDate(user.id, date); stats.total++; stats[a.status] = (stats[a.status] || 0) + 1; });
  stats.absent = stats.total - (stats.present || 0);
  return stats;
}
function changeAttendanceDate(delta) { attendanceDateCursor = addDays(attendanceDateCursor, delta); attendanceWeekCursor = startOfWeek(attendanceDateCursor); currentPage === 'attendance-management' ? renderAttendanceManagement() : renderAttendanceOverview(); }
function goTodayAttendance() { attendanceDateCursor = new Date(); attendanceWeekCursor = startOfWeek(new Date()); currentPage === 'attendance-management' ? renderAttendanceManagement() : renderAttendanceOverview(); }
function setAttendanceDate(value) { if (!value) return; attendanceDateCursor = parseISO(value); attendanceWeekCursor = startOfWeek(attendanceDateCursor); currentPage === 'attendance-management' ? renderAttendanceManagement() : renderAttendanceOverview(); }
function changeAttendanceWeek(delta) { attendanceWeekCursor = addDays(attendanceWeekCursor, delta * 7); renderAttendanceOverview(); }
function attendanceBadge(status, compact=false) { const m = attendanceStatusMeta(status); return `<span class="attendance-badge att-${status}" title="${m.label}">${compact ? m.short : `${m.icon} ${m.label}`}</span>`; }
function attendanceEditModal(userId) {
  if (!hasPermission('attendance.manage')) return;
  const user = getUser(userId); if (!user) return;
  const date = toISO(attendanceDateCursor); const current = attendanceForUserDate(userId, date);
  showModal(`${user.name} · Yoklama Durumu`, `<form id="attendanceForm" class="form-grid">
    <label>Durum<select name="status">${Object.entries(attendanceStatuses).map(([key,val]) => `<option value="${key}" ${current.status === key ? 'selected' : ''}>${val.label}</option>`).join('')}</select></label>
    <label>Başlangıç<input name="start" type="date" value="${date}" required></label>
    <label>Bitiş<input name="end" type="date" value="${date}" required></label>
    <label class="span-2">Açıklama<textarea name="note" placeholder="Görev yeri, rapor açıklaması vb.">${escapeHtml(current.source === 'manual' ? current.note : '')}</textarea></label>
    <div class="span-2 form-note">Onaylı izinler yoklamaya otomatik gelir. Buradan girilen kayıt, seçilen tarih aralığında otomatik kayda göre önceliklidir.</div>
    <div class="span-2"><button class="btn btn-primary btn-block">Durumu Kaydet</button></div>
  </form>`);
  document.getElementById('attendanceForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target); const start=f.get('start'), end=f.get('end');
    if (end < start) return toast('Bitiş tarihi başlangıçtan önce olamaz.');
    db.attendance.push({ id: Date.now(), userId: user.id, status: f.get('status'), start, end, note: f.get('note'), source: 'manual' });
    logAudit('attendance.update', `${user.name}: ${start}–${end} ${attendanceStatusMeta(f.get('status')).label}`);
    saveDB(); closeModal(); renderAttendanceManagement(); toast('Yoklama durumu kaydedildi.');
  });
}
function clearManualAttendance(userId) {
  if (!hasPermission('attendance.manage')) return;
  const date = toISO(attendanceDateCursor); const before = db.attendance.length;
  db.attendance = db.attendance.filter(x => !(x.userId === Number(userId) && x.start <= date && x.end >= date));
  if (db.attendance.length === before) return toast('Bu tarihte el ile girilmiş kayıt yok.');
  logAudit('attendance.clear', `${getUser(userId)?.name || userId}: ${date}`); saveDB(); renderAttendanceManagement(); toast('El ile girilen yoklama kaydı kaldırıldı.');
}
function openAttendanceHistory(userId) {
  if (!hasPermission('attendance.view')) return;
  const user=getUser(userId); if(!user) return;
  const manual=(db.attendance||[]).filter(x=>x.userId===user.id).sort((a,b)=>b.start.localeCompare(a.start));
  const leaves=(db.leaveRequests||[]).filter(x=>x.userId===user.id && ['approved','report'].includes(x.status)).sort((a,b)=>b.start.localeCompare(a.start));
  showModal(`${user.name} · Yoklama Geçmişi`, `<div class="quick-list">${[...manual.map(x=>({start:x.start,end:x.end,label:attendanceStatusMeta(x.status).label,note:x.note||'El ile kayıt'})),...leaves.map(x=>({start:x.start,end:x.end,label:attendanceStatusMeta(attendanceStatusFromLeave(x)).label,note:`${x.type} · İzin sisteminden`}))].sort((a,b)=>b.start.localeCompare(a.start)).map(x=>`<div class="quick-item"><div><strong>${x.label}</strong><span>${formatShortDate(x.start)} – ${formatShortDate(x.end)} · ${escapeHtml(x.note)}</span></div></div>`).join('') || '<div class="empty">Geçmiş kayıt bulunmuyor.</div>'}</div>`);
}
function renderAttendanceManagement() {
  if (!hasPermission('attendance.manage')) return goPage('dashboard');
  const date=toISO(attendanceDateCursor), stats=dailyAttendanceStats(date);
  const users=approvedUsers();
  document.getElementById('pageContent').innerHTML=`
    <div class="attendance-toolbar"><div><span class="kitchen-eyebrow">İDARİ İŞLER · GÜNLÜK YOKLAMA</span><h2>${formatDayDate(date)}</h2><p>Personel varsayılan olarak Mevcut kabul edilir. Sadece istisnaları girmeniz yeterlidir.</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeAttendanceDate(-1)">‹ Önceki Gün</button><button class="btn btn-secondary btn-sm" onclick="goTodayAttendance()">Bugün</button><input type="date" value="${date}" onchange="setAttendanceDate(this.value)"><button class="btn btn-primary btn-sm" onclick="changeAttendanceDate(1)">Sonraki Gün ›</button></div></div>
    <div class="grid grid-4 section-gap">${metric('👥','Toplam personel',stats.total+' kişi','Aktif üyeler')}${metric('✅','Mevcut',stats.present+' kişi','Varsayılan durum')}${metric('📌','Mevcut değil',stats.absent+' kişi','İzin, rapor, görev vb.')}${metric('📅','Onaylı izin',((stats.annual_leave||0)+(stats.excuse_leave||0)+(stats.road_leave||0))+' kişi','İzin sisteminden otomatik')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Personel durumları</h3><p>İzin sistemi otomatik; rapor, görev, kurs ve diğer durumlar idari işler tarafından girilebilir.</p></div></div><div class="table-wrap"><table><thead><tr><th>Personel</th><th>Görev</th><th>Bugünkü durum</th><th>Kaynak</th><th>Açıklama</th><th>İşlem</th></tr></thead><tbody>${users.map(user=>{const a=attendanceForUserDate(user.id,date);return `<tr><td><button class="person-link" onclick="openAttendanceHistory(${user.id})">${escapeHtml(user.name)}</button></td><td>${escapeHtml(user.title||'')}</td><td>${attendanceBadge(a.status)}</td><td>${a.source==='leave'?'İzin sistemi':a.source==='manual'?'İdari işler':'Varsayılan'}</td><td>${escapeHtml(a.note||'—')}</td><td><button class="btn btn-primary btn-sm" onclick="attendanceEditModal(${user.id})">Düzenle</button>${a.source==='manual'?` <button class="btn btn-secondary btn-sm" onclick="clearManualAttendance(${user.id})">Kaydı Kaldır</button>`:''}</td></tr>`}).join('')}</tbody></table></div></div>`;
}
function attendanceGroupHtml(date) {
  const groups={}; approvedUsers().forEach(u=>{const a=attendanceForUserDate(u.id,date); (groups[a.status] ||= []).push(u);});
  return Object.entries(attendanceStatuses).filter(([key])=>groups[key]?.length).map(([key,meta])=>`<div class="attendance-group"><div>${attendanceBadge(key)}<strong>${groups[key].length} kişi</strong></div><p>${groups[key].map(u=>escapeHtml(u.name)).join(', ')}</p></div>`).join('');
}
function renderAttendanceOverview() {
  if (!hasPermission('attendance.view')) return goPage('dashboard');
  const date=toISO(attendanceDateCursor), stats=dailyAttendanceStats(date), week=getWeekDates(attendanceWeekCursor);
  document.getElementById('pageContent').innerHTML=`
    <div class="attendance-toolbar"><div><span class="kitchen-eyebrow">KOMUTANLIK · PERSONEL DURUMU</span><h2>${formatDayDate(date)}</h2><p>Günlük mevcut ile haftalık personel hareketleri tek ekranda.</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeAttendanceDate(-1)">‹ Önceki Gün</button><button class="btn btn-secondary btn-sm" onclick="goTodayAttendance()">Bugün</button><input type="date" value="${date}" onchange="setAttendanceDate(this.value)"><button class="btn btn-primary btn-sm" onclick="changeAttendanceDate(1)">Sonraki Gün ›</button></div></div>
    <div class="grid grid-4 section-gap">${metric('👥','Toplam',stats.total+' kişi','Aktif personel')}${metric('✅','Mevcut',stats.present+' kişi',stats.total?('%'+Math.round(stats.present/stats.total*100)+' mevcudiyet'):'—')}${metric('🏖️','İzinli',((stats.annual_leave||0)+(stats.excuse_leave||0)+(stats.road_leave||0))+' kişi','Onaylı izinler')}${metric('📍','Diğer durumda',(stats.absent-((stats.annual_leave||0)+(stats.excuse_leave||0)+(stats.road_leave||0)))+' kişi','Rapor, görev, kurs vb.')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Bugünkü detay</h3><p>Durumlara göre isim listesi</p></div></div><div class="card-body attendance-groups">${attendanceGroupHtml(date)}</div></div>
    <div class="card section-gap"><div class="card-header calendar-toolbar"><div><h3>Haftalık yoklama</h3><p>${weekRangeText(attendanceWeekCursor)}</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeAttendanceWeek(-1)">‹ Önceki Hafta</button><button class="btn btn-secondary btn-sm" onclick="attendanceWeekCursor=startOfWeek(new Date());renderAttendanceOverview()">Bu Hafta</button><button class="btn btn-primary btn-sm" onclick="changeAttendanceWeek(1)">Sonraki Hafta ›</button></div></div><div class="table-wrap"><table class="attendance-week-table"><thead><tr><th>Personel</th>${week.map(d=>`<th>${new Intl.DateTimeFormat('tr-TR',{weekday:'short'}).format(parseISO(d))}<small>${formatShortDate(d).slice(0,5)}</small></th>`).join('')}</tr></thead><tbody>${approvedUsers().map(user=>`<tr><td><button class="person-link" onclick="openAttendanceHistory(${user.id})">${escapeHtml(user.name)}</button><small class="table-sub">${escapeHtml(user.title||'')}</small></td>${week.map(d=>{const a=attendanceForUserDate(user.id,d);return `<td>${attendanceBadge(a.status,true)}</td>`}).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

function getWeekDates(cursor) { return Array.from({ length: 7 }, (_, i) => toISO(addDays(startOfWeek(cursor), i))); }
function weekRangeText(cursor) { const dates = getWeekDates(cursor); return `${formatShortDate(dates[0])} – ${formatShortDate(dates[6])}`; }
function changeMealWeek(delta, management = false) {
  if (management) mealManagementWeekCursor = addDays(mealManagementWeekCursor, delta * 7);
  else mealWeekCursor = addDays(mealWeekCursor, delta * 7);
  management ? renderMealManagement() : renderMyMeals();
}
function goCurrentMealWeek(management = false) {
  if (management) mealManagementWeekCursor = startOfWeek(new Date());
  else mealWeekCursor = startOfWeek(new Date());
  management ? renderMealManagement() : renderMyMeals();
}
function getMealDay(userId, date) { return db.mealSelections?.[userId]?.[date] || { breakfast: '', lunch: '', dinner: '' }; }
function setMealDay(userId, date, value) {
  db.mealSelections[userId] ||= {};
  db.mealSelections[userId][date] = value;
}
function mealDayReservedCount(day) { return Object.values(day).filter(v => v === 'yes' || v === 'duty').length; }
function mealChoice(name, value, selected) {
  const labels = { yes: 'Yiyeceğim', no: 'Yemeyeceğim', duty: 'Görevdeyim / Ayır' };
  return `<label class="meal-pill ${selected === value ? 'selected' : ''}"><input type="radio" name="${name}" value="${value}" ${selected === value ? 'checked' : ''}><span>${labels[value]}</span></label>`;
}
function bindMealPills() {
  document.querySelectorAll('.meal-pill input').forEach(input => input.addEventListener('change', () => {
    document.querySelectorAll(`input[name="${CSS.escape(input.name)}"]`).forEach(x => x.closest('.meal-pill').classList.toggle('selected', x.checked));
  }));
}
function fillAllMeals(value) {
  document.querySelectorAll('#mealForm .meal-pill input').forEach(input => {
    input.checked = input.value === value;
    input.closest('.meal-pill').classList.toggle('selected', input.checked);
  });
}
function renderMyMeals() {
  const dates = getWeekDates(mealWeekCursor);
  const totalReserved = dates.reduce((sum, date) => sum + mealDayReservedCount(getMealDay(currentUser.id, date)), 0);
  const dutyCount = dates.reduce((sum, date) => sum + Object.values(getMealDay(currentUser.id, date)).filter(v => v === 'duty').length, 0);
  document.getElementById('pageContent').innerHTML = `
    <div class="summary-strip"><div><strong>${weekRangeText(mealWeekCursor)} tarihli yemek listesi</strong><div class="form-note">Tercihler için saat veya gün kısıtlaması bulunmuyor.</div></div><div><strong>Ayrılacak öğün: ${totalReserved}</strong><div class="form-note">Görevde ayrılacak: ${dutyCount} öğün</div></div></div>
    <div class="card section-gap"><div class="card-header calendar-toolbar"><div><h3>Tarihli yemek tercih listesi</h3><p>Her gün ve öğün için Yiyeceğim, Yemeyeceğim veya Görevdeyim / Ayır seçin.</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeMealWeek(-1)">‹ Önceki Hafta</button><button class="btn btn-secondary btn-sm" onclick="goCurrentMealWeek()">Bu Hafta</button><button class="btn btn-primary btn-sm" onclick="changeMealWeek(1)">Sonraki Hafta ›</button></div></div>
      <div class="card-body">
        <div class="meal-bulk-actions"><button class="btn btn-secondary btn-sm" type="button" onclick="fillAllMeals('yes')">Tümünü Yiyeceğim</button><button class="btn btn-secondary btn-sm" type="button" onclick="fillAllMeals('no')">Tümünü Yemeyeceğim</button><button class="btn btn-secondary btn-sm" type="button" onclick="fillAllMeals('duty')">Tümünü Görevdeyim / Ayır</button></div>
        <form id="mealForm"><div class="table-wrap"><table class="meal-date-table"><thead><tr><th>Tarih</th><th>Kahvaltı</th><th>Öğle</th><th>Akşam</th></tr></thead><tbody>
          ${dates.map(date => { const day = getMealDay(currentUser.id, date); return `<tr><td class="meal-date-cell"><strong>${formatDayDate(date)}</strong><small>${date}</small></td>${['breakfast', 'lunch', 'dinner'].map(meal => `<td><div class="meal-choice-group">${mealChoice(`${date}-${meal}`, 'yes', day[meal])}${mealChoice(`${date}-${meal}`, 'no', day[meal])}${mealChoice(`${date}-${meal}`, 'duty', day[meal])}</div></td>`).join('')}</tr>`; }).join('')}
        </tbody></table></div><button class="btn btn-primary section-gap" type="submit">Tarihli Listeyi Kaydet</button></form>
      </div></div>`;
  bindMealPills();
  document.getElementById('mealForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target);
    dates.forEach(date => setMealDay(currentUser.id, date, { breakfast: f.get(`${date}-breakfast`) || '', lunch: f.get(`${date}-lunch`) || '', dinner: f.get(`${date}-dinner`) || '' }));
    saveDB(); renderMyMeals(); toast('Yemek tercihleriniz kaydedildi.');
  });
}
function mealDateSummary(date) {
  const users = approvedUsers();
  const summary = { breakfast: 0, lunch: 0, dinner: 0, duty: 0, missing: 0 };
  users.forEach(user => {
    const day = getMealDay(user.id, date);
    ['breakfast', 'lunch', 'dinner'].forEach(meal => {
      if (day[meal] === 'yes' || day[meal] === 'duty') summary[meal]++;
      if (day[meal] === 'duty') summary.duty++;
      if (!day[meal]) summary.missing++;
    });
  });
  return summary;
}
function renderMealManagement() {
  if (!hasPermission('meal.manage')) return goPage('dashboard');
  const dates = getWeekDates(mealManagementWeekCursor);
  const users = approvedUsers();
  const total = dates.reduce((sum, date) => { const s = mealDateSummary(date); return sum + s.breakfast + s.lunch + s.dinner; }, 0);
  const missing = dates.reduce((sum, date) => sum + mealDateSummary(date).missing, 0);
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-4">${metric('🍲', 'Ayrılacak toplam öğün', total, weekRangeText(mealManagementWeekCursor))}${metric('👥', 'Listelenen personel', users.length + ' kişi', 'Müdür ve admin dahil')}${metric('📌', 'Eksik tercih', missing + ' öğün', 'Tercih girilmemiş hücreler')}${metric('🧾', 'Dönem gideri', money(db.expenses.reduce((s, x) => s + x.amount, 0)), 'Kayıtlı harcamalar')}</div>
    <div class="card section-gap"><div class="card-header calendar-toolbar"><div><h3>Tarihli toplu yemek listesi</h3><p>Her gün için ayrılacak öğün ve görevde ayrılacak yemek sayısı</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeMealWeek(-1,true)">‹ Önceki Hafta</button><button class="btn btn-secondary btn-sm" onclick="goCurrentMealWeek(true)">Bu Hafta</button><button class="btn btn-primary btn-sm" onclick="changeMealWeek(1,true)">Sonraki Hafta ›</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Kahvaltı</th><th>Öğle</th><th>Akşam</th><th>Görevdeyim / Ayır</th><th>Eksik Tercih</th><th>Detay</th></tr></thead><tbody>${dates.map(date => { const s = mealDateSummary(date); return `<tr><td><strong>${formatDayDate(date)}</strong></td><td>${s.breakfast} kişi</td><td>${s.lunch} kişi</td><td>${s.dinner} kişi</td><td>${s.duty} öğün</td><td>${s.missing ? `<span class="text-danger">${s.missing}</span>` : '0'}</td><td><button class="btn btn-secondary btn-sm" onclick="openMealDateDetail('${date}')">Personel Listesi</button></td></tr>`; }).join('')}</tbody></table></div>
    </div>
    <div class="card section-gap"><div class="card-header"><div><h3>Gider kayıtları</h3><p>Yemek hesabına eklenecek harcamalar</p></div><button class="btn btn-primary btn-sm" onclick="expenseModal()">Gider Ekle</button></div><div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Açıklama</th><th>Tutar</th></tr></thead><tbody>${db.expenses.map(x => `<tr><td>${formatDate(x.date)}</td><td>${escapeHtml(x.name)}</td><td><strong>${money(x.amount)}</strong></td></tr>`).join('')}</tbody></table></div></div>`;
}
function openMealDateDetail(date) {
  if (!hasPermission('meal.manage')) return;
  const rows = approvedUsers().map(user => {
    const day = getMealDay(user.id, date);
    return `<tr><td><button class="person-link" onclick="closeModal();openPersonnelLeaves(${user.id})">${escapeHtml(user.name)}</button></td>${['breakfast', 'lunch', 'dinner'].map(meal => `<td>${mealStatusChip(day[meal])}</td>`).join('')}</tr>`;
  }).join('');
  showModal(`${formatDayDate(date)} · Yemek Durumu`, `<div class="table-wrap"><table><thead><tr><th>Personel</th><th>Kahvaltı</th><th>Öğle</th><th>Akşam</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}
function mealStatusChip(status) {
  const cls = status === 'yes' ? 'success' : status === 'duty' ? 'info' : status === 'no' ? 'neutral' : 'warning';
  return `<span class="status ${cls}">${mealStatusNames[status || '']}</span>`;
}
function expenseModal() {
  if (!hasPermission('meal.manage')) return;
  showModal('Yeni Gider Ekle', `<form id="expenseForm" class="form-grid"><label>Tarih<input name="date" type="date" value="${toISO(new Date())}" required></label><label>Tutar<input name="amount" type="number" step="0.01" required></label><label class="span-2">Açıklama<input name="name" required></label><div class="span-2"><button class="btn btn-primary btn-block">Gideri Kaydet</button></div></form>`);
  document.getElementById('expenseForm').addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.target); db.expenses.push({ id: Date.now(), date: f.get('date'), name: f.get('name'), amount: Number(f.get('amount')) }); saveDB(); closeModal(); renderMealManagement(); toast('Gider kaydı eklendi.'); });
}


function getMealStatusGroups(date, meal) {
  const groups = { yes: [], duty: [], no: [], missing: [] };
  approvedUsers().forEach(user => {
    const status = getMealDay(user.id, date)[meal] || 'missing';
    groups[status].push(user);
  });
  return groups;
}
function cookMealStats(date, meal) {
  const groups = getMealStatusGroups(date, meal);
  return {
    prepared: groups.yes.length + groups.duty.length,
    yes: groups.yes.length,
    duty: groups.duty.length,
    no: groups.no.length,
    missing: groups.missing.length,
    total: approvedUsers().length
  };
}
function changeCookDate(delta) {
  cookDateCursor = addDays(cookDateCursor, delta);
  renderCookDashboard();
}
function goTodayCookDate() {
  cookDateCursor = new Date();
  renderCookDashboard();
}
function setCookDate(value) {
  if (!value) return;
  cookDateCursor = parseISO(value);
  renderCookDashboard();
}
function kitchenMealCard(date, meal) {
  const stats = cookMealStats(date, meal);
  const warning = stats.missing ? `<div class="kitchen-warning">⚠ ${stats.missing} personel tercih yapmadı</div>` : `<div class="kitchen-ready">✓ Tüm tercihler tamam</div>`;
  return `<article class="card kitchen-meal-card">
    <div class="kitchen-meal-head"><div><span>${meal === 'breakfast' ? '☕' : meal === 'lunch' ? '🍲' : '🍽'}</span><h3>${mealNames[meal]}</h3></div><button class="btn btn-secondary btn-sm" onclick="openCookMealDetail('${date}','${meal}')">İsim Listesi</button></div>
    <div class="kitchen-main-number"><strong>${stats.prepared}</strong><span>yemek hazırlanacak</span></div>
    <div class="kitchen-stat-grid">
      <div><strong>${stats.yes}</strong><span>Yerinde yiyecek</span></div>
      <div><strong>${stats.duty}</strong><span>Görevde / Ayrılacak</span></div>
      <div><strong>${stats.no}</strong><span>Yemeyecek</span></div>
      <div><strong>${stats.missing}</strong><span>Tercih yok</span></div>
    </div>
    ${warning}
  </article>`;
}
function renderCookDashboard() {
  if (!hasCookPermission()) return goPage('dashboard');
  const date = toISO(cookDateCursor);
  const stats = ['breakfast', 'lunch', 'dinner'].map(meal => cookMealStats(date, meal));
  const totalPrepared = stats.reduce((sum, x) => sum + x.prepared, 0);
  const totalDuty = stats.reduce((sum, x) => sum + x.duty, 0);
  const totalMissing = stats.reduce((sum, x) => sum + x.missing, 0);
  document.getElementById('pageContent').innerHTML = `
    <div class="kitchen-topbar">
      <div><span class="kitchen-eyebrow">GÜNLÜK MUTFAK PLANI</span><h2>${formatDayDate(date)}</h2><p>Hazırlanacak yemek sayısına “Yiyeceğim” ve “Görevdeyim / Ayır” seçimleri dahildir.</p></div>
      <div class="calendar-actions kitchen-date-actions"><button class="btn btn-secondary btn-sm" onclick="changeCookDate(-1)">‹ Önceki Gün</button><button class="btn btn-secondary btn-sm" onclick="goTodayCookDate()">Bugün</button><input type="date" value="${date}" onchange="setCookDate(this.value)" aria-label="Mutfak tarihi"><button class="btn btn-primary btn-sm" onclick="changeCookDate(1)">Sonraki Gün ›</button></div>
    </div>
    <div class="grid grid-4 section-gap kitchen-overview">
      ${metric('🍽', 'Toplam hazırlanacak', totalPrepared + ' öğün', 'Üç öğünün toplamı')}
      ${metric('📦', 'Görev için ayrılacak', totalDuty + ' paket', 'Görevdeyim / Ayır seçimleri')}
      ${metric('👥', 'Aktif personel', approvedUsers().length + ' kişi', 'Her öğün için değerlendirilen')}
      ${metric('⚠', 'Eksik tercih', totalMissing + ' seçim', totalMissing ? 'Miktar değişebilir' : 'Liste kesin')}
    </div>
    <div class="kitchen-meals section-gap">${['breakfast', 'lunch', 'dinner'].map(meal => kitchenMealCard(date, meal)).join('')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Günlük hazırlık özeti</h3><p>Aşçının hızlı kontrol listesi</p></div><div class="toolbar-right"><button class="btn btn-secondary btn-sm" onclick="renderCookDashboard()">↻ Yenile</button><button class="btn btn-secondary btn-sm" onclick="window.print()">Yazdır</button></div></div>
      <div class="table-wrap"><table class="kitchen-summary-table"><thead><tr><th>Öğün</th><th>Hazırlanacak</th><th>Yerinde yiyecek</th><th>Görevde / Ayrılacak</th><th>Yemeyecek</th><th>Tercih yok</th><th>Liste</th></tr></thead><tbody>${['breakfast','lunch','dinner'].map(meal => { const x = cookMealStats(date, meal); return `<tr><td><strong>${mealNames[meal]}</strong></td><td><span class="kitchen-table-total">${x.prepared}</span></td><td>${x.yes}</td><td>${x.duty}</td><td>${x.no}</td><td>${x.missing ? `<span class="text-danger">${x.missing}</span>` : '0'}</td><td><button class="btn btn-secondary btn-sm" onclick="openCookMealDetail('${date}','${meal}')">İsimleri Gör</button></td></tr>`; }).join('')}</tbody></table></div>
    </div>`;
}
function openCookMealDetail(date, meal) {
  if (!hasCookPermission()) return;
  const groups = getMealStatusGroups(date, meal);
  const groupBlock = (title, users, cls) => `<section class="kitchen-name-group ${cls}"><div><strong>${title}</strong><span>${users.length} kişi</span></div>${users.length ? `<ul>${users.map(user => `<li>${escapeHtml(user.name)}<small>${escapeHtml(user.title || '')}</small></li>`).join('')}</ul>` : '<p>Personel bulunmuyor.</p>'}</section>`;
  showModal(`${formatDayDate(date)} · ${mealNames[meal]}`, `<div class="kitchen-detail-summary"><strong>${groups.yes.length + groups.duty.length}</strong><span>toplam yemek hazırlanacak</span></div><div class="kitchen-name-groups">${groupBlock('Yerinde yiyecek', groups.yes, 'yes')}${groupBlock('Görevde / Ayrılacak', groups.duty, 'duty')}${groupBlock('Yemeyecek', groups.no, 'no')}${groupBlock('Tercih yapmadı', groups.missing, 'missing')}</div>`);
}

function renderMyFinance() {
  const debts = db.debts.filter(x => x.userId === currentUser.id);
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-3">${metric('₺', 'Toplam borç', money(debts.reduce((s, x) => s + x.amount, 0)), 'Dönem borçları')}${metric('✅', 'Ödenen', money(debts.reduce((s, x) => s + x.paid, 0)), 'Onaylanan ödemeler')}${metric('⏳', 'Kalan', money(debts.reduce((s, x) => s + Math.max(0, x.amount - x.paid), 0)), 'Ödeme bekleniyor')}</div>
    <div class="grid grid-2 section-gap"><div class="card"><div class="card-header"><div><h3>Ödeme bilgileri</h3><p>Havale açıklamasına ad soyad yazınız</p></div></div><div class="card-body"><label>Hesap sahibi<input value="${escapeHtml(db.settings.accountName)}" readonly></label><label class="section-gap">IBAN<input id="ibanInput" value="${escapeHtml(db.settings.iban)}" readonly></label><button class="btn btn-secondary section-gap" onclick="copyIban()">IBAN'ı Kopyala</button></div></div>
    <div class="card"><div class="card-header"><div><h3>Ödeme bildirimi</h3><p>Yaptığınız ödemeyi yönetime gönderin</p></div></div><div class="card-body"><button class="btn btn-primary" onclick="paymentModal()">Ödeme Bildir</button></div></div></div>
    <div class="card section-gap"><div class="card-header"><div><h3>Borç dökümü</h3><p>Dönem bazında ödeme durumunuz</p></div></div><div class="table-wrap"><table><thead><tr><th>Dönem</th><th>Borç</th><th>Ödenen</th><th>Kalan</th><th>Durum</th></tr></thead><tbody>${debts.map(x => `<tr><td>${x.period}</td><td>${money(x.amount)}</td><td>${money(x.paid)}</td><td><strong>${money(Math.max(0, x.amount - x.paid))}</strong></td><td>${statusBadge(x.paid >= x.amount ? 'paid' : 'unpaid')}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function renderFinanceManagement() {
  if (!hasPermission('finance.manage')) return goPage('dashboard');
  const totalExpense = db.expenses.reduce((s, x) => s + x.amount, 0);
  const collected = db.debts.reduce((s, x) => s + x.paid, 0);
  const waiting = db.debts.reduce((s, x) => s + Math.max(0, x.amount - x.paid), 0);
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-4">${metric('🏦', 'Önceki dönem devri', money(3200), 'Temmuz kapanışı')}${metric('✅', 'Tahsil edilen', money(collected), 'Onaylanan ödemeler')}${metric('🧾', 'Yapılan gider', money(totalExpense), 'Ağustos dönemi')}${metric('⏳', 'Bekleyen tahsilat', money(waiting), 'Personel borçları')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Personel borç ve ödeme durumu</h3><p>Müdür ve admin dahil bütün üyeler</p></div></div><div class="table-wrap"><table><thead><tr><th>Personel</th><th>Dönem</th><th>Borç</th><th>Ödenen</th><th>Kalan</th><th>Durum</th></tr></thead><tbody>${db.debts.map(x => `<tr><td><button class="person-link" onclick="openPersonnelLeaves(${x.userId})">${escapeHtml(getUser(x.userId)?.name || 'Silinmiş kullanıcı')}</button></td><td>${x.period}</td><td>${money(x.amount)}</td><td>${money(x.paid)}</td><td>${money(Math.max(0, x.amount - x.paid))}</td><td>${statusBadge(x.paid >= x.amount ? 'paid' : 'unpaid')}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card section-gap"><div class="card-header"><div><h3>Onay bekleyen ödeme bildirimleri</h3><p>Dekont ve tutar kontrolü</p></div></div><div class="table-wrap"><table><thead><tr><th>Personel</th><th>Tarih</th><th>Dönem</th><th>Tutar</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>${db.payments.map(p => `<tr><td>${escapeHtml(getUser(p.userId)?.name || '-')}</td><td>${formatDate(p.date)}</td><td>${p.period}</td><td>${money(p.amount)}</td><td>${statusBadge(p.status)}</td><td>${p.status === 'pending' ? `<button class="btn btn-success btn-sm" onclick="approvePayment(${p.id})">Onayla</button>` : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function copyIban() { navigator.clipboard?.writeText(db.settings.iban); toast('IBAN panoya kopyalandı.'); }
function paymentModal() {
  showModal('Ödeme Bildir', `<form id="paymentForm" class="form-grid"><label>Dönem<select name="period"><option>Ağustos 2026</option></select></label><label>Tutar<input name="amount" type="number" required></label><label>Ödeme tarihi<input name="date" type="date" value="${toISO(new Date())}" required></label><label>Dekont<input name="receipt" type="file" accept="image/*,.pdf"></label><div class="span-2"><button class="btn btn-primary btn-block">Bildirimi Gönder</button></div></form>`);
  document.getElementById('paymentForm').addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.target); db.payments.push({ id: Date.now(), userId: currentUser.id, period: f.get('period'), amount: Number(f.get('amount')), date: f.get('date'), status: 'pending' }); saveDB(); closeModal(); toast('Ödeme bildiriminiz onaya gönderildi.'); });
}
function approvePayment(id) { if (!hasPermission('finance.manage')) return; const p = db.payments.find(x => x.id === id); if (!p) return; p.status = 'approved'; const d = db.debts.find(x => x.userId === p.userId && x.period === p.period); if (d) d.paid = Math.min(d.amount, d.paid + p.amount); saveDB(); renderFinanceManagement(); toast('Ödeme onaylandı.'); }

function getRemainingLeave(user) {
  const approvedAnnual = db.leaveRequests.filter(x => x.userId === user.id && x.status === 'approved' && x.type === 'Yıllık İzin').reduce((s, x) => s + x.days, 0);
  return Math.max(0, user.annualAllowance - user.usedLeave - approvedAnnual);
}
function monthTitle(year, month) { return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1)); }
function changeLeaveMonth(delta) { leaveCalendarCursor = new Date(leaveCalendarCursor.getFullYear(), leaveCalendarCursor.getMonth() + delta, 1); renderLeaveManagement(); }
function goCurrentLeaveMonth() { leaveCalendarCursor = startOfMonth(new Date()); renderLeaveManagement(); }
function renderMyLeaves() {
  const own = db.leaveRequests.filter(x => x.userId === currentUser.id).sort((a, b) => b.start.localeCompare(a.start));
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-3">${metric('📅', 'Yıllık izin hakkı', currentUser.annualAllowance + ' gün', 'Tanımlı hak')}${metric('✅', 'Kullanılan izin', currentUser.usedLeave + ' gün', 'Kesinleşen kullanım')}${metric('⏳', 'Kullanılabilir izin', getRemainingLeave(currentUser) + ' gün', 'Onaylı izinler düşülmüştür')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>İzin taleplerim</h3><p>Müdür ve admin de kendi taleplerini bu ekrandan gönderir</p></div><button class="btn btn-primary btn-sm" onclick="leaveModal()">Yeni İzin Talebi</button></div>${own.length ? leaveTable(own, false) : '<div class="empty">Henüz izin talebiniz bulunmuyor.</div>'}</div>`;
}
function renderLeaveManagement() {
  if (!hasPermission('leave.view')) return goPage('dashboard');
  const year = leaveCalendarCursor.getFullYear(), month = leaveCalendarCursor.getMonth();
  const monthStart = `${year}-${pad(month + 1)}-01`;
  const monthEnd = `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;
  const monthly = db.leaveRequests.filter(x => x.start <= monthEnd && x.end >= monthStart).sort((a, b) => a.start.localeCompare(b.start));
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-4">${metric('📅', 'Toplam izin kaydı', db.leaveRequests.length, 'Tüm dönemler')}${metric('⏳', 'Onay bekleyen', db.leaveRequests.filter(x => x.status === 'pending').length, 'Değerlendirme gerekli')}${metric('✅', 'Onaylanan', db.leaveRequests.filter(x => x.status === 'approved').length, 'Planlanan izinler')}${metric('👥', monthTitle(year, month) + ' izinli', new Set(monthly.map(x => x.userId)).size + ' kişi', 'Ay içinde izin kaydı bulunan')}</div>
    <div class="card section-gap"><div class="card-header calendar-toolbar"><div><h3>${monthTitle(year, month)} izin takvimi</h3><p>Önceki ve gelecek aylara sınırsız geçiş yapılabilir</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeLeaveMonth(-1)">‹ Önceki Ay</button><button class="btn btn-secondary btn-sm" onclick="goCurrentLeaveMonth()">Bu Ay</button><button class="btn btn-primary btn-sm" onclick="changeLeaveMonth(1)">Sonraki Ay ›</button></div></div><div class="card-body">${calendarHtml(year, month)}</div></div>
    <div class="card section-gap"><div class="card-header"><div><h3>${monthTitle(year, month)} izinli personel listesi</h3><p>Gösterilen ayla kesişen bütün izinler</p></div>${hasPermission('leave.manage') ? '<button class="btn btn-secondary btn-sm" onclick="leaveModal(true)">Yönetici Kaydı Ekle</button>' : ''}</div>${monthly.length ? leaveTable(monthly, true) : '<div class="empty">Bu ay için izin kaydı bulunmuyor.</div>'}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Tüm izin talepleri</h3><p>Personel adına tıklayarak bütün izin geçmişini açabilirsiniz</p></div></div>${leaveTable(db.leaveRequests, true)}</div>`;
}
function leaveTable(items, actions, compact = false) {
  return `<div class="table-wrap"><table><thead><tr><th>Personel</th><th>İzin türü</th><th>Başlangıç</th><th>Bitiş</th><th>Gün</th>${compact ? '' : '<th>Şehir</th>'}<th>Durum</th>${actions ? '<th>İşlem</th>' : ''}</tr></thead><tbody>${items.map(x => `<tr><td>${(hasPermission('personnel.view') || hasPermission('leave.view')) ? `<button class="person-link" onclick="openPersonnelLeaves(${x.userId})">${escapeHtml(getUser(x.userId)?.name || '-')}</button>` : `<strong>${escapeHtml(getUser(x.userId)?.name || '-')}</strong>`}</td><td>${escapeHtml(x.type)}</td><td>${formatDate(x.start)}</td><td>${formatDate(x.end)}</td><td>${x.days}</td>${compact ? '' : `<td>${escapeHtml(x.city || '-')}</td>`}<td>${statusBadge(x.status)}</td>${actions ? `<td>${x.status === 'pending' && (hasPermission('leave.approve') || hasPermission('leave.manage')) ? `<button class="btn btn-success btn-sm" onclick="approveLeave(${x.id})">Onayla</button> <button class="btn btn-danger btn-sm" onclick="rejectLeave(${x.id})">Reddet</button>` : '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function calendarHtml(year, month) {
  const first = new Date(year, month, 1); const last = new Date(year, month + 1, 0); const mondayIndex = (first.getDay() + 6) % 7; const total = Math.ceil((mondayIndex + last.getDate()) / 7) * 7;
  const heads = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map(x => `<div class="calendar-head">${x}</div>`).join('');
  let days = '';
  for (let i = 0; i < total; i++) {
    const day = i - mondayIndex + 1;
    if (day < 1 || day > last.getDate()) { days += '<div class="calendar-day muted"></div>'; continue; }
    const date = `${year}-${pad(month + 1)}-${pad(day)}`;
    const events = db.leaveRequests.filter(x => date >= x.start && date <= x.end);
    days += `<div class="calendar-day"><div class="day-num">${day}</div>${events.map(e => `<button class="calendar-event ${e.status}" onclick="openPersonnelLeaves(${e.userId})">${escapeHtml(getUser(e.userId)?.name || '-')}</button>`).join('')}</div>`;
  }
  return `<div class="calendar">${heads}${days}</div>`;
}
function openPersonnelLeaves(userId) {
  if (!hasPermission('personnel.view') && !hasPermission('leave.view')) return;
  const user = getUser(userId); if (!user) return;
  const records = db.leaveRequests.filter(x => x.userId === userId).sort((a, b) => b.start.localeCompare(a.start));
  const approvedAnnual = records.filter(x => x.status === 'approved' && x.type === 'Yıllık İzin').reduce((s, x) => s + x.days, 0);
  const pendingAnnual = records.filter(x => x.status === 'pending' && x.type === 'Yıllık İzin').reduce((s, x) => s + x.days, 0);
  const preference = db.leavePreferences.find(x => x.userId === userId && x.year === db.settings.leavePlanYear);
  showModal(`${user.name} · Personel ve İzin Bilgileri`, `
    <div class="grid grid-4 compact-metrics">${metric('📅', 'Yıllık hak', user.annualAllowance + ' gün', 'Tanımlı hak')}${metric('✅', 'Kullanılan', user.usedLeave + ' gün', 'Kesinleşen kullanım')}${metric('🗓', 'Onaylı plan', approvedAnnual + ' gün', 'Gelecek izinler')}${metric('⏳', 'Kalan', getRemainingLeave(user) + ' gün', pendingAnnual + ' gün talep bekliyor')}</div>
    <div class="person-summary section-gap"><div><strong>Rol</strong><span>${escapeHtml(userRoleLabels(user))}</span></div><div><strong>Planlama puanı</strong><span>${user.planningScore ?? 0}</span></div><div><strong>${db.settings.leavePlanYear} tercihi</strong><span>${preference ? 'Gönderildi' : 'Gönderilmedi'}</span></div></div>
    ${preference ? `<div class="preference-summary section-gap"><div><strong>1. tercih</strong><span>${formatDate(preference.firstStart)} – ${formatDate(preference.firstEnd)}</span></div><div><strong>2. tercih</strong><span>${formatDate(preference.secondStart)} – ${formatDate(preference.secondEnd)}</span></div></div>` : ''}
    <div class="section-gap"><h3>Tüm izin kayıtları</h3>${records.length ? leaveTable(records, false, true) : '<div class="empty">Bu personele ait izin kaydı bulunmuyor.</div>'}</div>`);
}
function leaveModal(asManager = false) {
  const users = approvedUsers();
  showModal(asManager ? 'İzin Kaydı Ekle' : 'Yeni İzin Talebi', `<form id="leaveForm" class="form-grid">
    ${asManager ? `<label class="span-2">Personel<select name="userId">${users.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('')}</select></label>` : ''}
    <label>İzin türü<select name="type"><option>Yıllık İzin</option><option>Mazeret İzni</option><option>Sağlık İzni</option><option>Görev / Kurs</option><option>Yol İzni</option></select></label>
    <label>İzne gidilecek şehir<input name="city" required></label><label>Başlangıç tarihi<input name="start" type="date" required></label><label>Bitiş tarihi<input name="end" type="date" required></label>
    <label class="span-2">Açıklama<textarea name="note"></textarea></label><div class="span-2"><button class="btn btn-primary btn-block">${asManager ? 'Kaydı Ekle' : 'Talebi Gönder'}</button></div></form>`);
  document.getElementById('leaveForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target), start = f.get('start'), end = f.get('end');
    if (end < start) return toast('Bitiş tarihi başlangıçtan önce olamaz.');
    db.leaveRequests.push({ id: Date.now(), userId: asManager ? Number(f.get('userId')) : currentUser.id, type: f.get('type'), city: f.get('city'), start, end, days: daysBetween(start, end), note: f.get('note'), status: asManager ? 'approved' : 'pending' });
    saveDB(); closeModal(); asManager ? renderLeaveManagement() : renderMyLeaves(); toast(asManager ? 'İzin kaydı eklendi.' : 'İzin talebiniz onaya gönderildi.');
  });
}
function approveLeave(id) { if (!hasPermission('leave.approve') && !hasPermission('leave.manage')) return; const x = db.leaveRequests.find(r => r.id === id); if (x) { x.status = 'approved'; saveDB(); renderLeaveManagement(); toast('İzin talebi onaylandı.'); } }
function rejectLeave(id) { if (!hasPermission('leave.approve') && !hasPermission('leave.manage')) return; const x = db.leaveRequests.find(r => r.id === id); if (x) { x.status = 'rejected'; saveDB(); renderLeaveManagement(); toast('İzin talebi reddedildi.'); } }

function renderMyLeavePreference() {
  const year = db.settings.leavePlanYear;
  const preference = db.leavePreferences.find(x => x.userId === currentUser.id && x.year === year);
  const result = db.leavePlanResults.find(x => x.userId === currentUser.id && x.year === year);
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-3">${metric('🗓', 'Planlama yılı', year, 'Yönetim tarafından belirlenir')}${metric('⭐', 'Planlama puanınız', currentUser.planningScore ?? 0, currentUser.planningScoreNote || 'Puan açıklaması yönetimde tutulur')}${metric('📌', 'Dağıtım sonucu', result ? resultLabel(result) : 'Henüz oluşturulmadı', 'Puan sırası ve günlük kontenjan kullanılır')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>${year} yıllık izin tercih formu</h3><p>Her personelden birinci ve ikinci tarih tercihi alınır.</p></div></div><div class="card-body">
      <form id="preferenceForm" class="form-grid">
        <div class="span-2 preference-heading"><strong>1. Tercih</strong><span>Öncelikli izin dönemi</span></div>
        <label>Başlangıç<input name="firstStart" type="date" value="${preference?.firstStart || ''}" required></label><label>Bitiş<input name="firstEnd" type="date" value="${preference?.firstEnd || ''}" required></label>
        <div class="span-2 preference-heading"><strong>2. Tercih</strong><span>Birinci tercih uygun olmazsa değerlendirilecek dönem</span></div>
        <label>Başlangıç<input name="secondStart" type="date" value="${preference?.secondStart || ''}" required></label><label>Bitiş<input name="secondEnd" type="date" value="${preference?.secondEnd || ''}" required></label>
        <label class="span-2">Açıklama<textarea name="note" placeholder="Varsa planlamada dikkate alınmasını istediğiniz husus">${escapeHtml(preference?.note || '')}</textarea></label>
        <div class="span-2"><button class="btn btn-primary btn-block">Tercihlerimi Kaydet</button></div>
      </form>
    </div></div>
    ${preference ? `<div class="card section-gap"><div class="card-header"><div><h3>Gönderilen tercihler</h3><p>Son kayıt: ${formatDate(preference.submittedAt)}</p></div>${statusBadge('submitted')}</div><div class="card-body preference-summary"><div><strong>1. tercih</strong><span>${formatDate(preference.firstStart)} – ${formatDate(preference.firstEnd)} · ${daysBetween(preference.firstStart, preference.firstEnd)} gün</span></div><div><strong>2. tercih</strong><span>${formatDate(preference.secondStart)} – ${formatDate(preference.secondEnd)} · ${daysBetween(preference.secondStart, preference.secondEnd)} gün</span></div></div></div>` : ''}`;
  document.getElementById('preferenceForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target);
    const firstStart = f.get('firstStart'), firstEnd = f.get('firstEnd'), secondStart = f.get('secondStart'), secondEnd = f.get('secondEnd');
    if (firstEnd < firstStart || secondEnd < secondStart) return toast('Bitiş tarihi başlangıçtan önce olamaz.');
    if (![firstStart, firstEnd, secondStart, secondEnd].every(x => Number(x.slice(0, 4)) === year)) return toast(`Bütün tercihler ${year} yılı içinde olmalıdır.`);
    const existing = db.leavePreferences.find(x => x.userId === currentUser.id && x.year === year);
    const payload = { userId: currentUser.id, year, firstStart, firstEnd, secondStart, secondEnd, note: f.get('note'), submittedAt: toISO(new Date()), status: 'submitted' };
    if (existing) Object.assign(existing, payload); else db.leavePreferences.push({ id: Date.now(), ...payload });
    db.leavePlanResults = db.leavePlanResults.filter(x => x.year !== year);
    saveDB(); renderMyLeavePreference(); toast('Yıllık izin tercihleriniz kaydedildi.');
  });
}
function resultLabel(result) {
  if (result.status === 'allocated1') return '1. tercih ayrıldı';
  if (result.status === 'allocated2') return '2. tercih ayrıldı';
  if (result.status === 'published') return `${result.choice}. tercih takvime aktarıldı`;
  return 'Bekleme listesi';
}
function renderLeavePlanning() {
  if (!hasPermission('leave.plan')) return goPage('dashboard');
  const year = db.settings.leavePlanYear;
  const users = planningUsers();
  const preferences = db.leavePreferences.filter(x => x.year === year);
  const results = db.leavePlanResults.filter(x => x.year === year);
  const rows = users.slice().sort((a, b) => (b.planningScore ?? 0) - (a.planningScore ?? 0) || a.name.localeCompare(b.name, 'tr')).map(user => {
    const pref = preferences.find(x => x.userId === user.id);
    const result = results.find(x => x.userId === user.id);
    return `<tr><td><button class="person-link" onclick="openPersonnelLeaves(${user.id})">${escapeHtml(user.name)}</button><small class="table-sub">${escapeHtml(userRoleLabels(user))}</small></td><td><strong>${user.planningScore ?? 0}</strong><button class="text-button" onclick="planningScoreModal(${user.id})">Düzenle</button></td><td>${pref ? `${formatShortDate(pref.firstStart)} – ${formatShortDate(pref.firstEnd)}` : '—'}</td><td>${pref ? `${formatShortDate(pref.secondStart)} – ${formatShortDate(pref.secondEnd)}` : '—'}</td><td>${pref ? statusBadge('submitted') : statusBadge('unsubmitted')}</td><td>${result ? statusBadge(result.status) : '—'}</td><td>${result?.start ? `${formatShortDate(result.start)} – ${formatShortDate(result.end)}` : '—'}</td></tr>`;
  }).join('');
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-4">${metric('🗓', 'Planlama yılı', year, 'Tercihlerin uygulanacağı yıl')}${metric('📨', 'Tercih veren', preferences.length + ' / ' + users.length, 'Birinci ve ikinci tercih')}${metric('⭐', 'Dağıtım yöntemi', 'Puan sırası', 'Yüksek puan önce değerlendirilir')}${metric('👥', 'Günlük izin kontenjanı', db.settings.maxConcurrentLeave + ' kişi', 'Aynı tarihte azami')}</div>
    <div class="management-banner section-gap"><strong>Puanlı dağıtım taslağı</strong><span>Puan ölçütü henüz sabitlenmediği için her personelin puanı yönetici tarafından düzenlenebilir. Sistem önce 1. tercihi, doluysa 2. tercihi dener.</span></div>
    <div class="card section-gap"><div class="card-header"><div><h3>Yıllık izin tercih ve dağıtım tablosu</h3><p>Puan sırası, tercihler ve günlük kontenjan birlikte değerlendirilir.</p></div><div class="calendar-actions"><button class="btn btn-primary btn-sm" onclick="generateLeavePlan()">Planlama Önerisi Oluştur</button>${results.length ? '<button class="btn btn-success btn-sm" onclick="publishLeavePlan()">Planı İzin Takvimine Aktar</button>' : ''}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Personel</th><th>Puan</th><th>1. Tercih</th><th>2. Tercih</th><th>Tercih Durumu</th><th>Dağıtım</th><th>Ayrılan Tarih</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}
function dateRange(start, end) {
  const result = []; let cursor = parseISO(start); const last = parseISO(end);
  while (cursor <= last) { result.push(toISO(cursor)); cursor = addDays(cursor, 1); }
  return result;
}
function canAllocate(start, end, occupancy, capacity) { return dateRange(start, end).every(date => (occupancy[date] || 0) < capacity); }
function occupyRange(start, end, occupancy) { dateRange(start, end).forEach(date => { occupancy[date] = (occupancy[date] || 0) + 1; }); }
function generateLeavePlan() {
  if (!hasPermission('leave.plan')) return;
  const year = db.settings.leavePlanYear;
  const capacity = Math.max(1, Number(db.settings.maxConcurrentLeave || 1));
  const occupancy = {};
  const existingApproved = db.leaveRequests.filter(x => x.status === 'approved' && x.start.startsWith(String(year)));
  existingApproved.forEach(x => occupyRange(x.start, x.end, occupancy));
  const ordered = planningUsers().slice().sort((a, b) => (b.planningScore ?? 0) - (a.planningScore ?? 0) || a.name.localeCompare(b.name, 'tr'));
  const results = [];
  ordered.forEach(user => {
    const pref = db.leavePreferences.find(x => x.userId === user.id && x.year === year);
    if (!pref) return;
    if (canAllocate(pref.firstStart, pref.firstEnd, occupancy, capacity)) {
      occupyRange(pref.firstStart, pref.firstEnd, occupancy);
      results.push({ id: Date.now() + user.id, userId: user.id, year, choice: 1, start: pref.firstStart, end: pref.firstEnd, score: user.planningScore ?? 0, status: 'allocated1' });
    } else if (canAllocate(pref.secondStart, pref.secondEnd, occupancy, capacity)) {
      occupyRange(pref.secondStart, pref.secondEnd, occupancy);
      results.push({ id: Date.now() + user.id, userId: user.id, year, choice: 2, start: pref.secondStart, end: pref.secondEnd, score: user.planningScore ?? 0, status: 'allocated2' });
    } else {
      results.push({ id: Date.now() + user.id, userId: user.id, year, choice: 0, start: '', end: '', score: user.planningScore ?? 0, status: 'waitlist' });
    }
  });
  db.leavePlanResults = db.leavePlanResults.filter(x => x.year !== year).concat(results);
  saveDB(); renderLeavePlanning(); toast('Puan ve kontenjana göre planlama önerisi oluşturuldu.');
}
function publishLeavePlan() {
  if (!hasPermission('leave.plan')) return;
  const year = db.settings.leavePlanYear;
  const results = db.leavePlanResults.filter(x => x.year === year && ['allocated1', 'allocated2'].includes(x.status));
  results.forEach(result => {
    const exists = db.leaveRequests.some(x => x.userId === result.userId && x.start === result.start && x.end === result.end && x.source === 'annual-plan');
    if (!exists) db.leaveRequests.push({ id: Date.now() + result.userId, userId: result.userId, type: 'Yıllık İzin', start: result.start, end: result.end, days: daysBetween(result.start, result.end), city: '-', note: `${year} yıllık izin planlaması · ${result.choice}. tercih · Puan ${result.score}`, status: 'approved', source: 'annual-plan' });
    result.status = 'published';
  });
  saveDB(); renderLeavePlanning(); toast('Dağıtılan izinler yıllık izin takvimine aktarıldı.');
}

function renderLaundry() {
  const date = toISO(new Date()), times = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00'];
  const machines = ['Makine 1', 'Makine 2', 'Kurutma'];
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-4">${metric('🧺', 'Bugünkü randevu', db.laundry.filter(x => x.date === date).length, 'Tüm makineler')}${metric('✅', 'Uygun saat', 'Görüntüle', 'Boş slotlara tıklayın')}${metric('👤', 'Haftalık limit', db.settings.weeklyLaundryLimit, 'Kullanım hakkı')}${metric('🛠', 'Bakım durumu', 'Tümü aktif', 'Arıza bildirimi yok')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>${formatDayDate(date)}</h3><p>Boş saate tıklayarak randevu oluşturabilirsiniz</p></div></div><div class="card-body"><div class="laundry-board">
      <div class="head">Saat</div>${machines.map(m => `<div class="head">${m}</div>`).join('')}
      ${times.map(time => `<div><strong>${time}</strong></div>${machines.map(machine => { const booking = db.laundry.find(x => x.date === date && x.time === time && x.machine === machine); return booking ? `<div class="slot busy"><strong>${escapeHtml(getUser(booking.userId)?.name || '-')}</strong>${hasPermission('laundry.manage') || booking.userId === currentUser.id ? `<button class="btn btn-danger btn-sm" onclick="cancelLaundry(${booking.id})">İptal</button>` : 'Rezerve'}</div>` : `<div class="slot free" onclick="bookLaundry('${date}','${time}','${machine}')">+ Randevu Al</div>`; }).join('')}`).join('')}
    </div></div></div>`;
}
function bookLaundry(date, time, machine) { const userId = currentUser.id; if (db.laundry.some(x => x.userId === userId && x.date === date && x.time === time)) return toast('Bu saatte başka bir randevunuz bulunuyor.'); db.laundry.push({ id: Date.now(), userId, date, time, machine }); saveDB(); renderLaundry(); toast(`${machine} için ${time} randevusu oluşturuldu.`); }
function cancelLaundry(id) { const booking = db.laundry.find(x => x.id === id); if (!booking || (!hasPermission('laundry.manage') && booking.userId !== currentUser.id)) return; db.laundry = db.laundry.filter(x => x.id !== id); saveDB(); renderLaundry(); toast('Randevu iptal edildi.'); }

function renderReports() {
  if (!hasPermission('reports.view')) return goPage('dashboard');
  document.getElementById('pageContent').innerHTML = `<div class="grid grid-3">
    <div class="card"><div class="card-body">${reportCard('🍽', 'Yemek Katılım Raporu', 'Tarih ve öğün bazında katılım dökümü')}</div></div>
    <div class="card"><div class="card-body">${reportCard('₺', 'Borç ve Tahsilat Raporu', 'Dönemsel borç, ödeme ve bakiye özeti')}</div></div>
    <div class="card"><div class="card-body">${reportCard('📅', 'Yıllık İzin Raporu', 'Personel bazında kullanılan ve kalan izinler')}</div></div>
    <div class="card"><div class="card-body">${reportCard('⭐', 'İzin Planlama Raporu', 'Tercih, puan ve dağıtım sonuçları')}</div></div>
    <div class="card"><div class="card-body">${reportCard('🧺', 'Çamaşır Kullanım Raporu', 'Makine ve personel bazında kullanım')}</div></div>
    <div class="card"><div class="card-body">${reportCard('📊', 'Aylık Bilanço', 'Gelir, gider, tahsilat ve kasa durumu')}</div></div>
  </div>`;
}
function reportCard(icon, title, desc) { return `<div class="metric-icon">${icon}</div><h3>${title}</h3><p class="form-note">${desc}</p><div class="section-gap"><button class="btn btn-primary btn-sm" onclick="downloadCsv('${title}')">Excel/CSV İndir</button> <button class="btn btn-secondary btn-sm" onclick="toast('PDF raporu gerçek veritabanı aşamasında eklenecek.')">PDF</button></div>`; }
function downloadCsv(title) { const csv = 'Rapor;Tarih;Deger\n' + title + ';' + toISO(new Date()) + ';Demo rapor\n'; const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = title.replaceAll(' ', '_') + '.csv'; a.click(); URL.revokeObjectURL(a.href); toast('Rapor indirildi.'); }

function renderSettings() {
  if (!isAdmin()) return goPage('dashboard');
  document.getElementById('pageContent').innerHTML = `<div class="grid grid-2"><div class="card"><div class="card-header"><div><h3>Ortak sistem ayarları</h3><p>Bu ayarlar Firestore <strong>settings/app</strong> belgesine otomatik yazılır.</p></div></div><div class="card-body"><form id="settingsForm"><label>Sistem adı<input name="systemName" value="${escapeHtml(db.settings.systemName || 'GençServi')}"></label><label class="section-gap">Hesap sahibi<input name="accountName" value="${escapeHtml(db.settings.accountName)}"></label><label class="section-gap">IBAN<input name="iban" value="${escapeHtml(db.settings.iban)}"></label><label class="section-gap">Haftalık çamaşır kullanım limiti<input name="weeklyLaundryLimit" type="number" min="1" value="${db.settings.weeklyLaundryLimit}"></label><label class="section-gap">Yıllık izin planlama yılı<input name="leavePlanYear" type="number" min="2026" value="${db.settings.leavePlanYear}"></label><label class="section-gap">Aynı tarihte azami izinli personel<input name="maxConcurrentLeave" type="number" min="1" value="${db.settings.maxConcurrentLeave}"></label><button class="btn btn-primary section-gap">Ayarları Firestore'a Kaydet</button></form></div></div>
    <div class="card"><div class="card-header"><div><h3>Firebase / Firestore</h3><p>Veriler artık site üzerinden yönetilir.</p></div></div><div class="card-body"><div class="firebase-card"><strong>Proje: ${escapeHtml(window.FirebaseBridge?.projectId || 'gencservi-5d47e')}</strong><span>Kullanıcılar, yemek, izin, yoklama, ödeme ve çamaşır verileri ayrı Firestore koleksiyonlarında tutulur.</span><div class="sync-actions"><button class="btn btn-primary btn-sm" onclick="refreshFromCloud()">Buluttan Yenile</button><button class="btn btn-secondary btn-sm" onclick="exportBackup()">JSON Yedek İndir</button></div></div><p class="form-note section-gap">Geliştirme sırasında Firestore Test mode kullanılıyor. Gerçek personel verilerine geçmeden önce Security Rules kilitlenecek.</p></div></div></div>`;
  document.getElementById('settingsForm').addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.target); db.settings = { ...db.settings, systemName: f.get('systemName'), accountName: f.get('accountName'), iban: f.get('iban'), weeklyLaundryLimit: Number(f.get('weeklyLaundryLimit')), leavePlanYear: Number(f.get('leavePlanYear')), maxConcurrentLeave: Number(f.get('maxConcurrentLeave')) }; db.leavePlanResults = []; saveDB(); toast('Sistem ayarları Firestore senkronizasyonuna alındı.'); });
}
async function refreshFromCloud(showToast = true) {
  try {
    setCloudStatus('', 'Buluttan yenileniyor');
    const next = await window.FirebaseBridge.loadState();
    applyCloudState(next, true);
    setCloudStatus('online', 'Firestore bağlı');
    if (showToast) toast('Firestore verileri yenilendi.');
  } catch (error) { setCloudStatus('offline', 'Yenileme hatası'); toast(window.FirebaseBridge.errorMessage(error)); }
}
function exportBackup() { const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gencservi-v6-firestore-yedek.json'; a.click(); URL.revokeObjectURL(a.href); toast('Yedek dosyası indirildi.'); }
function resetDemo() { refreshFromCloud(); }

function renderProfile() {
  document.getElementById('pageContent').innerHTML = `<div class="grid grid-2"><div class="card"><div class="card-header"><div><h3>Profil bilgilerim</h3><p>Tek giriş hesabınızın kişisel bilgileri</p></div></div><div class="card-body"><form id="profileForm"><label>Ad soyad<input name="name" value="${escapeHtml(currentUser.name)}"></label><label class="section-gap">Telefon<input value="${currentUser.phone}" readonly></label><label class="section-gap">Görev / rütbe<input name="title" value="${escapeHtml(currentUser.title)}"></label><label class="section-gap">Yetki<input value="${escapeHtml(userRoleLabels(currentUser))}${hasManagementPermission() ? ' + Personel işlevleri' : ''}" readonly></label><button class="btn btn-primary section-gap">Bilgileri Kaydet</button></form></div></div><div class="card"><div class="card-header"><div><h3>Şifre güvenliği</h3><p>Şifrenizi düzenli olarak güncelleyin</p></div></div><div class="card-body"><button class="btn btn-secondary" onclick="openPasswordModal()">Şifremi Değiştir</button></div></div></div>`;
  document.getElementById('profileForm').addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.target); currentUser.name = f.get('name'); currentUser.title = f.get('title'); saveDB(); login(currentUser); toast('Profil bilgileriniz güncellendi.'); });
}

function openPasswordModal() {
  showModal('Şifre Değiştir', `<form id="passwordForm" class="form-grid"><label class="span-2">Yeni şifre<input name="password" type="password" minlength="6" required></label><label class="span-2">Yeni şifre tekrar<input name="confirm" type="password" minlength="6" required></label><div class="span-2"><button class="btn btn-primary btn-block">Şifreyi Güncelle</button></div></form>`);
  document.getElementById('passwordForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target);
    if (f.get('password') !== f.get('confirm')) return toast('Şifreler aynı değil.');
    try { await window.FirebaseBridge.changePassword(f.get('password')); closeModal(); toast('Firebase Authentication şifreniz güncellendi.'); }
    catch (error) { toast(window.FirebaseBridge.errorMessage(error)); }
  });
}

init();
