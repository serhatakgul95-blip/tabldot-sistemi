const APP_KEY = 'personel_yasam_v6';
const LEGACY_APP_KEYS = [];

const seed = {
  users: [], mealSelections: {}, expenses: [], payments: [], debts: [], leaveRequests: [], leavePreferences: [],
  leavePlanResults: [], laundry: [], laundryFaults: [], attendance: [], auditLogs: [],
  settings: {
    systemName: 'PBYS',
    iban: 'TR00 0000 0000 0000 0000 0000 00',
    accountName: 'Ortak Tabldot Hesabı',
    bankName: '',
    weeklyLaundryLimit: 2,
    leavePlanYear: 2027,
    leaveConcurrentPercent: 25,
    roadAllowanceDefault: 2,
    planningSecondChoiceBonus: 20,
    planningFirstChoiceBonus: 0,
    laundryMachineStatus: { 'Beyaz Çamaşır Makinesi': 'active', 'Gri Çamaşır Makinesi': 'active', 'Kurutma Makinesi': 'broken' }
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

const roleNames = { admin: 'Admin', manager: 'Müdür', staff: 'Personel', cook: 'Aşçı', tabldot: 'Tabldot Sorumlusu', administrative: 'İdari İşler', commander: 'Karakol Komutanı' };
const rolePermissions = {
  staff: [],
  cook: ['kitchen.view'],
  tabldot: ['meal.manage','finance.manage','reports.view'],
  administrative: ['personnel.view','attendance.view','attendance.manage','leave.view','leave.manage','meal.manage','finance.manage','reports.view'],
  commander: ['personnel.view','attendance.view','leave.view','leave.approve','leave.plan','reports.view'],
  manager: ['personnel.view','attendance.view','attendance.manage','leave.view','leave.manage','leave.approve','leave.plan','meal.manage','finance.manage','reports.view','kitchen.view','laundry.manage'],
  admin: ['*']
};
const mealNames = { breakfast: 'Kahvaltı', lunch: 'Öğle', dinner: 'Akşam' };
const mealStatusNames = { yes: 'Yiyecek (varsayılan)', no: 'Yemeyecek', duty: 'Görevdeyim / Ayır', leave: 'Yıllık izin · Tabldot dışı', '': 'Yiyecek (varsayılan)' };
const attendanceStatuses = {
  present: { label: 'Mevcut', short: 'M', icon: '✅' },
  annual_leave: { label: 'Yıllık İzin', short: 'İ', icon: '🏖️' },
  excuse_leave: { label: 'Mazeret İzni', short: 'Mİ', icon: '📅' },
  road_leave: { label: 'Yol İzni', short: 'Yİ', icon: '🛣️' },
  medical: { label: 'Raporlu / İstirahatli', short: 'R', icon: '🏥' },
  duty: { label: 'Görevli', short: 'G', icon: '📍' },
  temporary_duty: { label: 'Geçici Görevli', short: 'GG', icon: '🚗' },
  course: { label: 'Kurs / Eğitim', short: 'K', icon: '📚' },
  referral: { label: 'Sevkli', short: 'S', icon: '🚑' },
  rest: { label: 'Nöbet İstirahati', short: 'Nİ', icon: '😴' },
  other: { label: 'Diğer', short: 'D', icon: '•' }
};

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
  if (hasPermission('finance.manage')) management.push(['finance-management', '📊', 'Tabldot Bilanço']);
  if (hasPermission('leave.view')) management.push(['leave-management', '🧭', 'İzin Yönetimi']);
  if (hasPermission('leave.plan')) management.push(['leave-planning', '📈', 'Yıllık İzin Anket Sonuçları']);
  if (hasPermission('reports.view')) management.push(['reports', '📊', 'Raporlar']);
  if (isAdmin()) management.push(['settings', '⚙', 'Sistem Ayarları']);
  return [...common, ...management];
}
function createEmptyDB() {
  return {
    users: [], mealSelections: {}, expenses: [], payments: [], debts: [], leaveRequests: [], leavePreferences: [],
    leavePlanResults: [], laundry: [], laundryFaults: [], attendance: [], auditLogs: [], settings: { ...seed.settings, systemName: 'PBYS' }
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
  data.laundryFaults ||= [];
  data.attendance ||= [];
  data.auditLogs ||= [];
  data.settings = { ...seed.settings, systemName: 'PBYS', ...(data.settings || {}) };
  const roleMap = { admin: ['staff','admin'], manager: ['staff','manager'], staff: ['staff'], cook: ['staff','cook'], tabldot: ['staff','tabldot'], administrative: ['staff','administrative'], commander: ['staff','commander'] };
  data.users.forEach(u => {
    u.roles = Array.isArray(u.roles) && u.roles.length ? u.roles : (roleMap[u.role] || ['staff']);
    u.extraPermissions ||= [];
    u.annualAllowance = Number(u.annualAllowance ?? 30);
    u.roadAllowance = Number(u.roadAllowance ?? 2);
    u.usedLeave = Number(u.usedLeave ?? 0);
    u.usedRoadLeave = Number(u.usedRoadLeave ?? 0);
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
    allocated2: ['info', '2. Tercih'], waitlist: ['warning', 'Bekleme Listesi'], published: ['success', 'Açıklandı'], accepted: ['success','Kabul Edildi'], reselect: ['warning','Tekrar Tercih İstendi'], draft: ['neutral','Taslak'], warning: ['warning','Tekrar Tercih İstendi']
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
    const hasAdmin = await window.FirebaseBridge.hasAnyAdmin();
    document.getElementById('bootstrapBox').classList.toggle('hidden', hasAdmin);
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

function concurrentLeaveCapacity() {
  const total = approvedUsers().length;
  return Math.max(1, Math.floor(total * Number(db.settings.leaveConcurrentPercent || 25) / 100));
}
function getApprovedAnnualDays(userId, futureToo = true) {
  const today = toISO(new Date());
  return db.leaveRequests
    .filter(x => x.userId === Number(userId) && x.status === 'approved' && x.type === 'Yıllık İzin' && (futureToo || x.end <= today))
    .reduce((sum, x) => sum + Number(x.days || daysBetween(x.start, x.end)), 0);
}
function getApprovedRoadDays(userId, futureToo = true) {
  const today = toISO(new Date());
  return db.leaveRequests
    .filter(x => x.userId === Number(userId) && x.status === 'approved' && x.type === 'Yol İzni' && (futureToo || x.end <= today))
    .reduce((sum, x) => sum + Number(x.days || daysBetween(x.start, x.end)), 0);
}
function getRoadRemaining(user) {
  return Math.max(0, Number(user.roadAllowance ?? 2) - Number(user.usedRoadLeave || 0) - getApprovedRoadDays(user.id));
}
function isApprovedAnnualLeaveOnDate(userId, date) {
  return db.leaveRequests.some(x => x.userId === Number(userId) && x.status === 'approved' && x.type === 'Yıllık İzin' && x.start <= date && x.end >= date);
}
function effectiveMealStatus(userId, date, meal) {
  if (isApprovedAnnualLeaveOnDate(userId, date)) return 'leave';
  const explicit = getMealDay(userId, date)[meal];
  if (explicit === 'no' || explicit === 'duty') return explicit;
  return 'yes';
}
function preferenceDurationForDate(dateValue) {
  if (!dateValue) return 0;
  const month = parseISO(dateValue).getMonth() + 1;
  return [6,7,8,9].includes(month) ? 20 : 10;
}
function preferenceEndForStart(start) {
  const days = preferenceDurationForDate(start);
  return days ? toISO(addDays(parseISO(start), days - 1)) : '';
}
const TR_HOLIDAYS_2027 = [
  {start:'2027-01-01', end:'2027-01-01', name:'Yılbaşı'},
  {start:'2027-03-08', end:'2027-03-11', name:'Ramazan Bayramı'},
  {start:'2027-04-23', end:'2027-04-23', name:'23 Nisan'},
  {start:'2027-05-01', end:'2027-05-01', name:'Emek ve Dayanışma Günü'},
  {start:'2027-05-15', end:'2027-05-19', name:'Kurban Bayramı'},
  {start:'2027-05-19', end:'2027-05-19', name:'19 Mayıs'},
  {start:'2027-07-15', end:'2027-07-15', name:'15 Temmuz'},
  {start:'2027-08-30', end:'2027-08-30', name:'30 Ağustos'},
  {start:'2027-10-28', end:'2027-10-29', name:'Cumhuriyet Bayramı'}
];
function holidaysForYear(year) {
  if (Number(year) === 2027) return TR_HOLIDAYS_2027;
  return [
    {start:`${year}-01-01`, end:`${year}-01-01`, name:'Yılbaşı'},
    {start:`${year}-04-23`, end:`${year}-04-23`, name:'23 Nisan'},
    {start:`${year}-05-01`, end:`${year}-05-01`, name:'Emek ve Dayanışma Günü'},
    {start:`${year}-05-19`, end:`${year}-05-19`, name:'19 Mayıs'},
    {start:`${year}-07-15`, end:`${year}-07-15`, name:'15 Temmuz'},
    {start:`${year}-08-30`, end:`${year}-08-30`, name:'30 Ağustos'},
    {start:`${year}-10-28`, end:`${year}-10-29`, name:'Cumhuriyet Bayramı'}
  ];
}
function rangeHolidayNames(start, end, year) {
  return holidaysForYear(year).filter(h => start <= h.end && end >= h.start).map(h => h.name);
}
function isCommander(user=currentUser) { return hasRole('commander', user); }

function renderDashboard() {
  const ownDebt = db.debts.filter(x => x.userId === currentUser.id).reduce((s, x) => s + Math.max(0, x.amount - x.paid), 0);
  const remaining = getRemainingLeave(currentUser);
  const preference = db.leavePreferences.find(x => x.userId === currentUser.id && x.year === db.settings.leavePlanYear);
  const currentWeek = getWeekDates(mealWeekCursor);
  const mealCount = currentWeek.reduce((sum, date) => sum + ['breakfast','lunch','dinner'].filter(meal => ['yes','duty'].includes(effectiveMealStatus(currentUser.id,date,meal))).length, 0);

  const personal = `
    <div class="grid grid-4">
      ${metric('🍽', 'Bu haftaki ücretli öğün', mealCount, 'Tercih yoksa varsayılan: yiyecek')}
      ${metric('₺', 'Güncel borcunuz', money(ownDebt), 'Ödeme bilgileri kendi ekranınızda')}
      ${metric('📅', 'Kullanılabilir yıllık izin', remaining + ' gün', 'Yıllık hak: ' + (currentUser.annualAllowance ?? 30) + ' gün')}
      ${metric('🛣️', 'Kalan yol izni', getRoadRemaining(currentUser) + ' gün', 'Yol izni hakkı: ' + (currentUser.roadAllowance ?? 2) + ' gün')}
    </div>
    <div class="grid grid-2 section-gap">
      <div class="card"><div class="card-header"><div><h3>Kişisel işlemlerim</h3><p>Tek hesapla kişisel ve yetkili işlemler birlikte yürütülür</p></div></div><div class="card-body quick-list">
        ${quick('🍽', 'Tarihli yemek listesini güncelle', 'Varsayılan olarak yemek yiyecek kabul edilirsiniz', "goPage('my-meals')")}
        ${hasCookPermission() ? quick('👨‍🍳', 'Bugünün yemek sayılarını aç', 'Kahvaltı, öğle ve akşam hazırlık sayıları', "goPage('cook-dashboard')") : ''}
        ${!isCommander() ? quick('📅', 'Yeni izin talebi oluştur', 'Yıllık, günübirlik ve diğer izin talepleri', "leaveModal()") : ''}
        ${quick('⭐', 'Yıllık izin tercihlerini gönder', '1. ve 2. tercih alınır', "goPage('leave-preference')")}
      </div></div>
      <div class="card"><div class="card-header"><div><h3>Duyurular</h3><p>Ortak bilgilendirmeler</p></div></div><div class="card-body quick-list">
        ${notice('Yemek sistemi', 'Tercih yapmayan personel yemek yiyecek kabul edilir.')}
        ${notice('İzin planlaması', db.settings.leavePlanYear + ' yılı için iki tarih tercihi alınmaktadır.')}
        ${notice('Yıllık izin tercihi', preference ? 'Tercihiniz sisteme kaydedildi.' : 'Henüz tercih göndermediniz.')}
      </div></div>
    </div>`;

  if (!hasManagementPermission()) {
    document.getElementById('pageContent').innerHTML = personal;
    return;
  }

  const pendingMembers = db.users.filter(u => !u.approved).length;
  const pendingLeaves = db.leaveRequests.filter(x => x.status === 'pending').length;
  const submitted = db.leavePreferences.filter(x => x.year === db.settings.leavePlanYear && x.status !== 'reselect').length;
  document.getElementById('pageContent').innerHTML = personal + `
    <div class="management-banner section-gap"><strong>${userRoleLabels(currentUser)} yetkileri açık</strong><span>Aynı hesapla kişisel ve yönetim işlemlerine erişebilirsiniz.</span></div>
    <div class="grid grid-4 section-gap">
      ${metric('👥', 'Aktif personel', approvedUsers().length, pendingMembers + ' üyelik onay bekliyor')}
      ${metric('🕓', 'Bekleyen izin talebi', pendingLeaves, 'Değerlendirme gerekli')}
      ${metric('⭐', 'Yıllık tercih veren', submitted + ' kişi', db.settings.leavePlanYear + ' planlama yılı')}
      ${metric('📏', 'Aynı anda izinli sınırı', concurrentLeaveCapacity() + ' kişi', '%' + (db.settings.leaveConcurrentPercent || 25) + ' mevcut sınırı')}
    </div>
    <div class="card section-gap"><div class="card-header"><div><h3>Yönetim kısa yolları</h3><p>Yetkinize bağlı ortak ekranlar</p></div></div><div class="card-body quick-list">
      ${quick('👥', 'Personel listesini aç', 'Bilgi, rol/yetki ve izin geçmişi', "goPage('members')")}
      ${hasPermission('attendance.manage') ? quick('📝', 'Bugünkü yoklamayı gir', 'İzin, rapor, görev ve bulunduğu yer', "goPage('attendance-management')") : ''}
      ${hasPermission('attendance.view') ? quick('📋', 'Günlük / haftalık yoklamayı gör', 'Mevcut ve mevcut olmayan personel özeti', "goPage('attendance-overview')") : ''}
      ${hasPermission('meal.manage') ? quick('📊', 'Tabldot bilançosunu aç', 'Malzeme gideri, öğün maliyeti ve kişi borcu', "goPage('finance-management')") : ''}
      ${hasPermission('leave.plan') ? quick('📈', 'Yıllık izin anket sonuçlarını aç', 'Tercih yoğunluğu, tatiller ve değerlendirme', "goPage('leave-planning')") : ''}
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
      ${metric('🕓', 'Onay bekleyen', pending.length, isAdmin() ? 'Admin işlemi gerekli' : 'Yetkili görüntüleme')}
    </div>
    <div class="card section-gap"><div class="card-header"><div><h3>Onay bekleyen üyelikler</h3><p>Tek giriş ekranından yapılan kayıtlar</p></div></div>
      ${pending.length ? `<div class="table-wrap"><table><thead><tr><th>Personel</th><th>Telefon</th><th>Görev</th><th>İşlem</th></tr></thead><tbody>${pending.map(u => `<tr><td><strong>${escapeHtml(u.name)}</strong></td><td>${u.phone}</td><td>${escapeHtml(u.title)}</td><td>${isAdmin() ? `<button class="btn btn-success btn-sm" onclick="approveMember(${u.id})">Onayla</button> <button class="btn btn-danger btn-sm" onclick="rejectMember(${u.id})">Reddet</button>` : 'Admin onayı bekleniyor'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Onay bekleyen üyelik bulunmuyor.</div>'}
    </div>
    <div class="card section-gap"><div class="card-header"><div><h3>Tüm aktif personeller</h3><p>Personel bilgileri, izin geçmişi ve yetkiler tek noktadan yönetilir.</p></div>${isAdmin() ? '<button class="btn btn-primary btn-sm" onclick="newMemberModal()">Personel Ekle</button>' : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Ad soyad</th><th>Telefon</th><th>Rol</th><th>Görev</th><th>Yıllık kalan</th><th>Yol kalan</th><th>İşlem</th></tr></thead><tbody>${active.map(u => `<tr><td><button class="person-link" onclick="openPersonnelLeaves(${u.id})">${escapeHtml(u.name)}</button></td><td>${u.phone}</td><td>${escapeHtml(userRoleLabels(u))}</td><td>${escapeHtml(u.title)}</td><td>${getRemainingLeave(u)} gün</td><td>${getRoadRemaining(u)} gün</td><td>
        <button class="btn btn-secondary btn-sm" onclick="openPersonnelLeaves(${u.id})">İzinleri</button>
        ${(isAdmin() || hasPermission('leave.manage')) ? `<button class="btn btn-secondary btn-sm" onclick="editMemberModal(${u.id})">Bilgileri Düzenle</button>` : ''}
        ${isAdmin() ? `<button class="btn btn-primary btn-sm" onclick="roleModal(${u.id})">Rol / Yetki</button>` : ''}
      </td></tr>`).join('')}</tbody></table></div>
    </div>`;
}
function approveMember(id) { if (!isAdmin()) return; const u = getUser(id); if (u) { u.approved = true; u.rejected = false; saveDB(); renderMembers(); toast('Üyelik onaylandı.'); } }
function rejectMember(id) { if (!isAdmin()) return; const u = getUser(id); if (u) { u.approved = false; u.rejected = true; saveDB(); renderMembers(); toast('Başvuru reddedildi. Firebase Authentication hesabı güvenlik nedeniyle silinmedi.'); } }
function newMemberModal() {
  if (!isAdmin()) return;
  showModal('Yeni Personel Ekle', `<form id="newMemberForm" class="form-grid">
    <label>Ad soyad<input name="name" required></label><label>Telefon<input name="phone" required></label>
    <label>Görev / rütbe<input name="title" required></label><label>Rol<select name="role"><option value="staff">Personel</option><option value="cook">Aşçı</option><option value="tabldot">Tabldot Sorumlusu</option><option value="manager">Müdür</option><option value="administrative">İdari İşler</option><option value="commander">Karakol Komutanı</option><option value="admin">Admin</option></select></label>
    <label>Yıllık izin hakkı<input name="annualAllowance" type="number" value="30" min="0"></label><label>Yol izni hakkı<input name="roadAllowance" type="number" value="2" min="0"></label><label>Planlama puanı<input name="planningScore" type="number" value="50" min="0" max="1000"></label>
    <label class="span-2">Geçici şifre<input name="password" type="password" minlength="6" placeholder="En az 6 karakter" required></label>
    <div class="span-2"><button class="btn btn-primary btn-block">Personeli Kaydet</button></div></form>`);
  document.getElementById('newMemberForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const role = f.get('role');
    const profile = { id: Date.now(), name: f.get('name').trim(), phone: normalizePhone(f.get('phone')), title: f.get('title').trim(), role, roles: role === 'staff' ? ['staff'] : ['staff', role], extraPermissions: [], approved: true, rejected: false, annualAllowance: Number(f.get('annualAllowance')), roadAllowance: Number(f.get('roadAllowance') || 2), usedLeave: 0, usedRoadLeave: 0, planningScore: Number(f.get('planningScore')), planningScoreNote: '' };
    try {
      await window.FirebaseBridge.adminCreateUser(profile, f.get('password'));
      closeModal(); await refreshFromCloud(false); renderMembers(); toast('Firebase Authentication hesabı ve personel kaydı oluşturuldu.');
    } catch (error) { toast(window.FirebaseBridge.errorMessage(error)); }
  });
}

function editMemberModal(userId) {
  if (!isAdmin() && !hasPermission('leave.manage')) return;
  const user = getUser(userId); if (!user) return;
  showModal(`${user.name} · Personel Bilgileri`, `<form id="editMemberForm" class="form-grid">
    <label>Ad soyad<input name="name" value="${escapeHtml(user.name)}" required></label>
    <label>Telefon<input name="phone" value="${escapeHtml(user.phone)}" readonly required><small class="form-note">Giriş kimliği olduğu için bu test sürümünde değiştirilemez.</small></label>
    <label>Görev / rütbe<input name="title" value="${escapeHtml(user.title || '')}" required></label>
    <label>Yıllık izin hakkı<input name="annualAllowance" type="number" min="0" value="${user.annualAllowance ?? 30}"></label>
    <label>Yol izni hakkı<input name="roadAllowance" type="number" min="0" value="${user.roadAllowance ?? 2}"></label>
    <label>Kullanılmış yıllık izin (eski manuel bakiye)<input name="usedLeave" type="number" min="0" value="${user.usedLeave ?? 0}"></label>
    <label>Kullanılmış yol izni (eski manuel bakiye)<input name="usedRoadLeave" type="number" min="0" value="${user.usedRoadLeave ?? 0}"></label>
    <div class="span-2"><button class="btn btn-primary btn-block">Bilgileri Kaydet</button></div>
  </form>`);
  document.getElementById('editMemberForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target);
    user.name = f.get('name').trim();
    user.title = f.get('title').trim();
    user.annualAllowance = Number(f.get('annualAllowance') || 30);
    user.roadAllowance = Number(f.get('roadAllowance') || 2);
    user.usedLeave = Number(f.get('usedLeave') || 0);
    user.usedRoadLeave = Number(f.get('usedRoadLeave') || 0);
    logAudit('personnel.update', `${user.name} personel bilgileri güncellendi`);
    saveDB(); closeModal(); renderMembers(); toast('Personel bilgileri güncellendi.');
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
  const available = ['staff','cook','tabldot','administrative','commander','manager','admin'];
  const permissionLabels = {
    'personnel.view':'Personel listesini gör','attendance.view':'Yoklama özetini gör','attendance.manage':'Yoklama girişi yap',
    'leave.view':'Tüm izinleri gör','leave.manage':'İzin kaydı ekle/düzenle','leave.approve':'İzin taleplerini onayla','leave.plan':'Yıllık izin planlamasını yönet',
    'meal.manage':'Yemek yönetimini gör','finance.manage':'Tabldot bilançosunu yönet','kitchen.view':'Aşçı ekranını gör','laundry.manage':'Çamaşır/arızaları yönet','reports.view':'Raporları gör'
  };
  showModal(`${user.name} · Rol ve Yetki`, `<form id="roleForm">
    <p class="form-note">Bir kullanıcıya birden fazla rol verilebilir. Son admin hesabının admin yetkisi kaldırılamaz.</p>
    <div class="role-check-grid section-gap">${available.map(role => `<label class="role-check"><input type="checkbox" name="roles" value="${role}" ${userRoles(user).includes(role) ? 'checked' : ''}><span><strong>${roleNames[role]}</strong><small>${(rolePermissions[role] || []).join(', ') || 'Temel personel işlevleri'}</small></span></label>`).join('')}</div>
    <h4 class="section-gap">Ek özel yetkiler</h4><p class="form-note">Rol paketine ek olarak kişiye özel yetki verilebilir.</p>
    <div class="role-check-grid section-gap">${Object.entries(permissionLabels).map(([key,label])=>`<label class="role-check"><input type="checkbox" name="extraPermissions" value="${key}" ${(user.extraPermissions||[]).includes(key)?'checked':''}><span><strong>${label}</strong><small>${key}</small></span></label>`).join('')}</div>
    <div class="section-gap"><button class="btn btn-primary btn-block">Rol ve Yetkileri Kaydet</button></div>
  </form>`);
  document.getElementById('roleForm').addEventListener('submit', e => {
    e.preventDefault(); const fd=new FormData(e.target); const roles=[...fd.getAll('roles')]; if(!roles.length)roles.push('staff');
    const removingAdmin=userRoles(user).includes('admin')&&!roles.includes('admin');
    const otherAdmins=approvedUsers().filter(u=>u.id!==user.id&&userRoles(u).includes('admin'));
    if(removingAdmin&&otherAdmins.length===0)return toast('Sistemde en az bir admin kalmalıdır. Son admin yetkisi kaldırılamaz.');
    if(removingAdmin&&user.id===currentUser.id&&!confirm('Kendi admin yetkinizi kaldırıyorsunuz. Devam etmek istiyor musunuz?'))return;
    user.roles=[...new Set(roles)]; user.extraPermissions=[...new Set(fd.getAll('extraPermissions'))];
    user.role=roles.includes('admin')?'admin':roles.includes('commander')?'commander':roles.includes('administrative')?'administrative':roles.includes('manager')?'manager':roles.includes('tabldot')?'tabldot':roles.includes('cook')?'cook':'staff';
    logAudit('role.update',`${user.name}: ${userRoleLabels(user)} · Ek: ${(user.extraPermissions||[]).join(', ')}`);
    saveDB();closeModal();renderMembers();renderNav();toast('Rol ve yetkiler güncellendi.');
  });
}
function attendanceStatusMeta(status) { return attendanceStatuses[status] || attendanceStatuses.other; }
function attendanceStatusFromLeave(req) {
  const text = `${req.type || ''}`.toLocaleLowerCase('tr-TR');
  if (text.includes('yıllık')) return 'annual_leave';
  if (text.includes('mazeret')) return 'excuse_leave';
  if (text.includes('yol')) return 'road_leave';
  if (text.includes('sağlık') || req.status === 'report') return 'medical';
  return 'other';
}
const attendancePlaceSuggestions = ['Karakol', 'Yemekhane', 'Nizamiye', 'İdari İşler', 'Devriye', 'Araç Görevi', 'Dış Görev'];
function attendanceForUserDate(userId, date) {
  const manual = (db.attendance || []).filter(x => x.userId === Number(userId) && x.start <= date && x.end >= date).sort((a,b) => b.id - a.id)[0];
  if (manual) return { status: manual.status, task: manual.task || manual.note || '', note: manual.note || '', location: manual.location || '', source: 'manual', record: manual };
  const leave = (db.leaveRequests || []).find(x => x.userId === Number(userId) && ['approved','report'].includes(x.status) && x.start <= date && x.end >= date);
  if (leave) return { status: attendanceStatusFromLeave(leave), task: '', note: leave.type, location: '', source: 'leave', record: leave };
  return { status: 'present', task: '', note: '', location: '', source: 'default', record: null };
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
    <label>Bulunduğu yer / görev yeri<input name="location" list="attendancePlaces" value="${escapeHtml(current.source === 'manual' ? current.location : '')}" placeholder="Örn. Yemekhane, Nizamiye"></label>
    <datalist id="attendancePlaces">${attendancePlaceSuggestions.map(x => `<option value="${escapeHtml(x)}"></option>`).join('')}</datalist>
    <label>Başlangıç<input name="start" type="date" value="${date}" required></label>
    <label>Bitiş<input name="end" type="date" value="${date}" required></label>
    <label class="span-2">Görev / Açıklama<input name="task" value="${escapeHtml(current.source === 'manual' ? (current.task || current.note || '') : '')}" placeholder="Örn. Şehir merkezine çıkış yaptı"></label>
    <label class="span-2">Ek not<textarea name="note" placeholder="Varsa ek açıklama, rapor detayı vb.">${escapeHtml(current.source === 'manual' ? (current.note || '') : '')}</textarea></label>
    <div class="span-2 form-note">“Durum” yoklama halini, “Bulunduğu yer” görev yerini; “Görev / Açıklama” ise serbest metinle o günkü görevi belirtir.</div>
    <div class="span-2"><button class="btn btn-primary btn-block">Durumu Kaydet</button></div>
  </form>`);
  document.getElementById('attendanceForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target); const start=f.get('start'), end=f.get('end');
    if (end < start) return toast('Bitiş tarihi başlangıçtan önce olamaz.');
    const location = String(f.get('location') || '').trim();
    db.attendance.push({ id: Date.now(), userId: user.id, status: f.get('status'), start, end, location, task: String(f.get('task') || '').trim(), note: f.get('note'), source: 'manual' });
    logAudit('attendance.update', `${user.name}: ${start}–${end} ${attendanceStatusMeta(f.get('status')).label}${location ? ` · ${location}` : ''}`);
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
  showModal(`${user.name} · Yoklama Geçmişi`, `<div class="quick-list">${[...manual.map(x=>({start:x.start,end:x.end,label:attendanceStatusMeta(x.status).label,location:x.location||'',note:[x.task,x.note].filter(Boolean).join(' · ')||'El ile kayıt'})),...leaves.map(x=>({start:x.start,end:x.end,label:attendanceStatusMeta(attendanceStatusFromLeave(x)).label,location:'',note:`${x.type} · İzin sisteminden`}))].sort((a,b)=>b.start.localeCompare(a.start)).map(x=>`<div class="quick-item"><div><strong>${x.label}${x.location ? ` · ${escapeHtml(x.location)}` : ''}</strong><span>${formatShortDate(x.start)} – ${formatShortDate(x.end)} · ${escapeHtml(x.note)}</span></div></div>`).join('') || '<div class="empty">Geçmiş kayıt bulunmuyor.</div>'}</div>`);
}
function renderAttendanceManagement() {
  if (!hasPermission('attendance.manage')) return goPage('dashboard');
  const date=toISO(attendanceDateCursor), stats=dailyAttendanceStats(date);
  const users=approvedUsers();
  document.getElementById('pageContent').innerHTML=`
    <div class="attendance-toolbar"><div><span class="kitchen-eyebrow">İDARİ İŞLER · GÜNLÜK YOKLAMA</span><h2>${formatDayDate(date)}</h2><p>Personel varsayılan olarak Mevcut kabul edilir. Sadece istisnaları girmeniz yeterlidir.</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeAttendanceDate(-1)">‹ Önceki Gün</button><button class="btn btn-secondary btn-sm" onclick="goTodayAttendance()">Bugün</button><input type="date" value="${date}" onchange="setAttendanceDate(this.value)"><button class="btn btn-primary btn-sm" onclick="changeAttendanceDate(1)">Sonraki Gün ›</button></div></div>
    <div class="grid grid-4 section-gap">${metric('👥','Toplam personel',stats.total+' kişi','Aktif üyeler')}${metric('✅','Mevcut',stats.present+' kişi','Varsayılan durum')}${metric('📌','Mevcut değil',stats.absent+' kişi','İzin, rapor, görev vb.')}${metric('📅','Onaylı izin',((stats.annual_leave||0)+(stats.excuse_leave||0)+(stats.road_leave||0))+' kişi','İzin sisteminden otomatik')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Personel durumları</h3><p>İzin sistemi otomatik; idari işler ayrıca personelin bulunduğu yeri (Yemekhane, Nizamiye vb.) kaydedebilir.</p></div></div><div class="table-wrap"><table><thead><tr><th>Personel</th><th>Rütbe / Görev</th><th>Bugünkü durum</th><th>Bulunduğu yer</th><th>Görev / Açıklama</th><th>Kaynak</th><th>Ek not</th><th>İşlem</th></tr></thead><tbody>${users.map(user=>{const a=attendanceForUserDate(user.id,date);return `<tr><td><button class="person-link" onclick="openAttendanceHistory(${user.id})">${escapeHtml(user.name)}</button></td><td>${escapeHtml(user.title||'')}</td><td>${attendanceBadge(a.status)}</td><td><strong>${escapeHtml(a.location||'—')}</strong></td><td>${escapeHtml(a.task||'—')}</td><td>${a.source==='leave'?'İzin sistemi':a.source==='manual'?'İdari işler':'Varsayılan'}</td><td>${escapeHtml(a.note||'—')}</td><td><button class="btn btn-primary btn-sm" onclick="attendanceEditModal(${user.id})">Düzenle</button>${a.source==='manual'?` <button class="btn btn-secondary btn-sm" onclick="clearManualAttendance(${user.id})">Kaydı Kaldır</button>`:''}</td></tr>`}).join('')}</tbody></table></div></div>`;
}
function attendanceGroupHtml(date) {
  const groups={}; approvedUsers().forEach(u=>{const a=attendanceForUserDate(u.id,date); (groups[a.status] ||= []).push({user:u, attendance:a});});
  return Object.entries(attendanceStatuses).filter(([key])=>groups[key]?.length).map(([key,meta])=>`<div class="attendance-group"><div>${attendanceBadge(key)}<strong>${groups[key].length} kişi</strong></div><p>${groups[key].map(x=>`${escapeHtml(x.user.name)}${x.attendance.location ? ` <small>(${escapeHtml(x.attendance.location)})</small>` : ''}${x.attendance.task ? ` <small>— ${escapeHtml(x.attendance.task)}</small>` : ''}`).join(', ')}</p></div>`).join('');
}
function attendanceLocationHtml(date) {
  const groups = {};
  approvedUsers().forEach(u => {
    const a = attendanceForUserDate(u.id, date);
    const location = String(a.location || '').trim();
    if (!location) return;
    (groups[location] ||= []).push(u);
  });
  const entries = Object.entries(groups).sort((a,b) => a[0].localeCompare(b[0], 'tr'));
  if (!entries.length) return '<div class="empty">Bu tarih için konum / görev yeri kaydı girilmemiş.</div>';
  return entries.map(([location, users]) => `<div class="attendance-group"><div><span class="attendance-badge att-present">📍 ${escapeHtml(location)}</span><strong>${users.length} kişi</strong></div><p>${users.map(u=>escapeHtml(u.name)).join(', ')}</p></div>`).join('');
}
function renderAttendanceOverview() {
  if (!hasPermission('attendance.view')) return goPage('dashboard');
  const date=toISO(attendanceDateCursor), stats=dailyAttendanceStats(date), week=getWeekDates(attendanceWeekCursor);
  document.getElementById('pageContent').innerHTML=`
    <div class="attendance-toolbar"><div><span class="kitchen-eyebrow">KOMUTANLIK · PERSONEL DURUMU</span><h2>${formatDayDate(date)}</h2><p>Günlük mevcut ile haftalık personel hareketleri tek ekranda.</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeAttendanceDate(-1)">‹ Önceki Gün</button><button class="btn btn-secondary btn-sm" onclick="goTodayAttendance()">Bugün</button><input type="date" value="${date}" onchange="setAttendanceDate(this.value)"><button class="btn btn-primary btn-sm" onclick="changeAttendanceDate(1)">Sonraki Gün ›</button></div></div>
    <div class="grid grid-4 section-gap">${metric('👥','Toplam',stats.total+' kişi','Aktif personel')}${metric('✅','Mevcut',stats.present+' kişi',stats.total?('%'+Math.round(stats.present/stats.total*100)+' mevcudiyet'):'—')}${metric('🏖️','İzinli',((stats.annual_leave||0)+(stats.excuse_leave||0)+(stats.road_leave||0))+' kişi','Onaylı izinler')}${metric('📍','Diğer durumda',(stats.absent-((stats.annual_leave||0)+(stats.excuse_leave||0)+(stats.road_leave||0)))+' kişi','Rapor, görev, kurs vb.')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Bugünkü detay</h3><p>Durumlara göre isim listesi; girilmişse bulunduğu yer parantez içinde gösterilir.</p></div></div><div class="card-body attendance-groups">${attendanceGroupHtml(date)}</div></div>
    <div class="card section-gap"><div class="card-header"><div><h3>Bulunduğu yere göre dağılım</h3><p>Yemekhane, Nizamiye ve el ile girilen diğer görev yerleri</p></div></div><div class="card-body attendance-groups">${attendanceLocationHtml(date)}</div></div>
    <div class="card section-gap"><div class="card-header calendar-toolbar"><div><h3>Haftalık yoklama</h3><p>${weekRangeText(attendanceWeekCursor)}</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeAttendanceWeek(-1)">‹ Önceki Hafta</button><button class="btn btn-secondary btn-sm" onclick="attendanceWeekCursor=startOfWeek(new Date());renderAttendanceOverview()">Bu Hafta</button><button class="btn btn-primary btn-sm" onclick="changeAttendanceWeek(1)">Sonraki Hafta ›</button></div></div><div class="table-wrap"><table class="attendance-week-table"><thead><tr><th>Personel</th>${week.map(d=>`<th>${new Intl.DateTimeFormat('tr-TR',{weekday:'short'}).format(parseISO(d))}<small>${formatShortDate(d).slice(0,5)}</small></th>`).join('')}</tr></thead><tbody>${approvedUsers().map(user=>`<tr><td><button class="person-link" onclick="openAttendanceHistory(${user.id})">${escapeHtml(user.name)}</button><small class="table-sub">${escapeHtml(user.title||'')}</small></td>${week.map(d=>{const a=attendanceForUserDate(user.id,d);return `<td title="${escapeHtml(a.location || attendanceStatusMeta(a.status).label)}">${attendanceBadge(a.status,true)}${a.location ? `<small class="attendance-location-mini">${escapeHtml(a.location)}</small>` : ''}${a.task ? `<small class="attendance-task-mini">${escapeHtml(a.task)}</small>` : ''}</td>`}).join('')}</tr>`).join('')}</tbody></table></div></div>`;
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
function mealDayReservedCount(day, userId = currentUser?.id, date = '') {
  if (!userId || !date) return Object.values(day || {}).filter(v => v !== 'no').length;
  return ['breakfast','lunch','dinner'].filter(meal => ['yes','duty'].includes(effectiveMealStatus(userId,date,meal))).length;
}
function mealChoice(name, value, selected) {
  const labels = { no: 'Yemeyeceğim', duty: 'Görevdeyim / Ayır' };
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
  const totalReserved = dates.reduce((sum, date) => sum + ['breakfast','lunch','dinner'].filter(meal => ['yes','duty'].includes(effectiveMealStatus(currentUser.id,date,meal))).length, 0);
  const dutyCount = dates.reduce((sum, date) => sum + ['breakfast','lunch','dinner'].filter(meal => effectiveMealStatus(currentUser.id,date,meal) === 'duty').length, 0);
  document.getElementById('pageContent').innerHTML = `
    <div class="summary-strip"><div><strong>${weekRangeText(mealWeekCursor)} yemek listesi</strong><div class="form-note">Seçim yapmadığınız öğünlerde varsayılan olarak yemek yiyeceğiniz kabul edilir.</div></div><div><strong>Ücretli öğün: ${totalReserved}</strong><div class="form-note">Görevde ayrılacak: ${dutyCount} öğün</div></div></div>
    <div class="card section-gap"><div class="card-header calendar-toolbar"><div><h3>Tarihli yemek tercihleri</h3><p>Sadece istisnaları işaretleyin: Yemeyeceğim veya Görevdeyim / Ayır. Onaylı yıllık izin günleri otomatik olarak tabldot dışıdır.</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeMealWeek(-1)">‹ Önceki Hafta</button><button class="btn btn-secondary btn-sm" onclick="goCurrentMealWeek()">Bu Hafta</button><button class="btn btn-primary btn-sm" onclick="changeMealWeek(1)">Sonraki Hafta ›</button></div></div>
      <div class="card-body">
        <form id="mealForm">
          <div class="meal-mobile-list">
          ${dates.map(date => {
            const day = getMealDay(currentUser.id, date);
            const leave = isApprovedAnnualLeaveOnDate(currentUser.id,date);
            return `<section class="meal-day-card ${leave ? 'meal-on-leave' : ''}">
              <div class="meal-day-head"><div><strong>${formatDayDate(date)}</strong><small>${date}</small></div>${leave ? '<span class="status warning">Yıllık izin · Tabldot dışı</span>' : '<span class="status success">Varsayılan: Yiyecek</span>'}</div>
              <div class="meal-day-grid">${['breakfast','lunch','dinner'].map(meal => `<div class="meal-unit"><strong>${mealNames[meal]}</strong>${leave ? '<span class="meal-leave-note">İzin nedeniyle ücret yansımaz</span>' : `<div class="meal-choice-group">${mealChoice(`${date}-${meal}`,'no',day[meal])}${mealChoice(`${date}-${meal}`,'duty',day[meal])}</div><button type="button" class="text-button meal-reset" onclick="clearMealChoice('${date}','${meal}')">Varsayılana dön</button>`}</div>`).join('')}</div>
            </section>`;
          }).join('')}
          </div>
          <button class="btn btn-primary section-gap" type="submit">Tarihli Listeyi Kaydet</button>
        </form>
      </div></div>`;
  bindMealPills();
  document.getElementById('mealForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target);
    dates.forEach(date => {
      if (isApprovedAnnualLeaveOnDate(currentUser.id,date)) return;
      setMealDay(currentUser.id, date, {
        breakfast: f.get(`${date}-breakfast`) || '',
        lunch: f.get(`${date}-lunch`) || '',
        dinner: f.get(`${date}-dinner`) || ''
      });
    });
    saveDB(); renderMyMeals(); toast('Yemek tercihleriniz kaydedildi.');
  });
}

function clearMealChoice(date, meal) {
  const day = getMealDay(currentUser.id, date);
  day[meal] = '';
  setMealDay(currentUser.id, date, day);
  saveDB(); renderMyMeals(); toast('Öğün varsayılan Yiyecek durumuna döndürüldü.');
}

function mealDateSummary(date) {
  const users = approvedUsers();
  const summary = { breakfast: 0, lunch: 0, dinner: 0, duty: 0, no: 0, leave: 0 };
  users.forEach(user => {
    ['breakfast','lunch','dinner'].forEach(meal => {
      const status = effectiveMealStatus(user.id,date,meal);
      if (status === 'yes' || status === 'duty') summary[meal]++;
      if (status === 'duty') summary.duty++;
      if (status === 'no') summary.no++;
      if (status === 'leave') summary.leave++;
    });
  });
  return summary;
}
function renderMealManagement() {
  if (!hasPermission('meal.manage')) return goPage('dashboard');
  const dates = getWeekDates(mealManagementWeekCursor);
  const users = approvedUsers();
  const total = dates.reduce((sum, date) => { const x = mealDateSummary(date); return sum + x.breakfast + x.lunch + x.dinner; }, 0);
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-4">${metric('🍲', 'Ücretli toplam öğün', total, weekRangeText(mealManagementWeekCursor))}${metric('👥', 'Aktif personel', users.length + ' kişi', 'Tercih yoksa yemek yiyecek')}${metric('🏖️', 'İzin nedeniyle düşen', dates.reduce((s,d)=>s+mealDateSummary(d).leave,0) + ' öğün', 'Sadece onaylı yıllık izin')}${metric('🧾', 'Kayıtlı malzeme gideri', money(db.expenses.reduce((s, x) => s + x.amount, 0)), 'Bilanço sayfasında hesaplanır')}</div>
    <div class="card section-gap"><div class="card-header calendar-toolbar"><div><h3>Tarihli toplu yemek listesi</h3><p>Varsayılan durum Yiyecek; sadece Yemeyeceğim, Görevde/Ayır ve onaylı yıllık izin istisnaları gösterilir.</p></div><div class="calendar-actions"><button class="btn btn-secondary btn-sm" onclick="changeMealWeek(-1,true)">‹ Önceki Hafta</button><button class="btn btn-secondary btn-sm" onclick="goCurrentMealWeek(true)">Bu Hafta</button><button class="btn btn-primary btn-sm" onclick="changeMealWeek(1,true)">Sonraki Hafta ›</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Kahvaltı</th><th>Öğle</th><th>Akşam</th><th>Görevde/Ayır</th><th>Yemeyecek</th><th>İzin düşümü</th><th>Detay</th></tr></thead><tbody>${dates.map(date => { const x = mealDateSummary(date); return `<tr><td><strong>${formatDayDate(date)}</strong></td><td>${x.breakfast} kişi</td><td>${x.lunch} kişi</td><td>${x.dinner} kişi</td><td>${x.duty} öğün</td><td>${x.no} öğün</td><td>${x.leave} öğün</td><td><button class="btn btn-secondary btn-sm" onclick="openMealDateDetail('${date}')">Personel Listesi</button></td></tr>`; }).join('')}</tbody></table></div>
    </div>`;
}
function openMealDateDetail(date) {
  if (!hasPermission('meal.manage')) return;
  const rows = approvedUsers().map(user => `<tr><td><strong>${escapeHtml(user.name)}</strong></td>${['breakfast','lunch','dinner'].map(meal => `<td>${mealStatusChip(effectiveMealStatus(user.id,date,meal))}</td>`).join('')}</tr>`).join('');
  showModal(`${formatDayDate(date)} · Yemek Durumu`, `<div class="table-wrap"><table><thead><tr><th>Personel</th><th>Kahvaltı</th><th>Öğle</th><th>Akşam</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}
function mealStatusChip(status) {
  const label = status === 'yes' ? 'Yiyecek (varsayılan)' : status === 'duty' ? 'Görevde / Ayır' : status === 'no' ? 'Yemeyecek' : status === 'leave' ? 'Yıllık izin · Tabldot dışı' : 'Yiyecek (varsayılan)';
  const cls = status === 'yes' ? 'success' : status === 'duty' ? 'info' : status === 'no' ? 'neutral' : status === 'leave' ? 'warning' : 'success';
  return `<span class="status ${cls}">${label}</span>`;
}
function expenseModal() {
  if (!hasPermission('meal.manage')) return;
  showModal('Yeni Gider Ekle', `<form id="expenseForm" class="form-grid"><label>Tarih<input name="date" type="date" value="${toISO(new Date())}" required></label><label>Tutar<input name="amount" type="number" step="0.01" required></label><label class="span-2">Açıklama<input name="name" required></label><div class="span-2"><button class="btn btn-primary btn-block">Gideri Kaydet</button></div></form>`);
  document.getElementById('expenseForm').addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.target); db.expenses.push({ id: Date.now(), date: f.get('date'), name: f.get('name'), amount: Number(f.get('amount')) }); logAudit('expense.create', `${f.get('date')} · ${f.get('name')} · ${money(Number(f.get('amount')))}`); saveDB(); closeModal(); currentPage === 'finance-management' ? renderFinanceManagement() : renderMealManagement(); toast('Gider kaydı eklendi.'); });
}

function editExpenseModal(id) {
  if (!hasPermission('finance.manage') && !hasPermission('meal.manage')) return;
  const x = db.expenses.find(e => e.id === Number(id)); if (!x) return;
  showModal('Malzeme / Gider Düzenle', `<form id="editExpenseForm" class="form-grid">
    <label>Tarih<input name="date" type="date" value="${x.date}" required></label>
    <label>Tutar<input name="amount" type="number" step="0.01" min="0" value="${Number(x.amount || 0)}" required></label>
    <label class="span-2">Malzeme / Açıklama<input name="name" value="${escapeHtml(x.name || '')}" required></label>
    <div class="span-2"><button class="btn btn-primary btn-block">Değişiklikleri Kaydet</button></div>
  </form>`);
  document.getElementById('editExpenseForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target);
    const before = { date: x.date, name: x.name, amount: x.amount };
    const oldPeriod = String(x.date).slice(0,7);
    x.date = f.get('date'); x.name = String(f.get('name') || '').trim(); x.amount = Number(f.get('amount') || 0);
    const newPeriod = String(x.date).slice(0,7);
    logAudit('expense.update', `${before.date} · ${before.name} · ${money(before.amount)} → ${x.date} · ${x.name} · ${money(x.amount)}`);
    recalculateExistingPeriodDebts(oldPeriod);
    if (newPeriod !== oldPeriod) recalculateExistingPeriodDebts(newPeriod);
    saveDB(); closeModal(); renderFinanceManagement(); toast('Gider kaydı güncellendi; mevcut dönem borçları yeniden hesaplandı.');
  });
}
function deleteExpense(id) {
  if (!hasPermission('finance.manage') && !hasPermission('meal.manage')) return;
  const x = db.expenses.find(e => e.id === Number(id)); if (!x) return;
  if (!confirm(`${x.name} gider kaydı silinsin mi?`)) return;
  const period = String(x.date).slice(0,7);
  db.expenses = db.expenses.filter(e => e.id !== Number(id));
  logAudit('expense.delete', `${x.date} · ${x.name} · ${money(x.amount)} silindi`);
  recalculateExistingPeriodDebts(period);
  saveDB(); renderFinanceManagement(); toast('Gider kaydı silindi; mevcut dönem borçları yeniden hesaplandı.');
}
function periodLabelFromKey(period) {
  const [y,m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('tr-TR',{month:'long',year:'numeric'}).format(new Date(y,m-1,1));
}
function balanceRowsForPeriod(period) {
  const [py,pm] = period.split('-').map(Number), lastDay = new Date(py,pm,0).getDate();
  const start = `${py}-${pad(pm)}-01`, end = `${py}-${pad(pm)}-${pad(lastDay)}`;
  const totalExpense = db.expenses.filter(x=>x.date>=start&&x.date<=end).reduce((a,x)=>a+Number(x.amount||0),0);
  const rows = approvedUsers().map(user=>{let count=0;dateRange(start,end).forEach(date=>['breakfast','lunch','dinner'].forEach(meal=>{if(['yes','duty'].includes(effectiveMealStatus(user.id,date,meal)))count++;}));return{user,count};});
  const totalMeals = rows.reduce((a,x)=>a+x.count,0), unit = totalMeals ? totalExpense / totalMeals : 0;
  return { start, end, totalExpense, rows, totalMeals, unit, label: periodLabelFromKey(period) };
}
function recalculateExistingPeriodDebts(period) {
  if (!period) return;
  const calc = balanceRowsForPeriod(period);
  if (!db.debts.some(d => d.period === calc.label)) return;
  calc.rows.forEach(x => {
    const amount = Number((x.count * calc.unit).toFixed(2));
    const d = db.debts.find(d => d.userId === x.user.id && d.period === calc.label);
    if (d) d.amount = amount;
  });
}



function getMealStatusGroups(date, meal) {
  const groups = { yes: [], duty: [], no: [], leave: [] };
  approvedUsers().forEach(user => groups[effectiveMealStatus(user.id,date,meal)].push(user));
  return groups;
}
function cookMealStats(date, meal) {
  const groups = getMealStatusGroups(date, meal);
  return { prepared: groups.yes.length + groups.duty.length, yes: groups.yes.length, duty: groups.duty.length, no: groups.no.length, leave: groups.leave.length, total: approvedUsers().length };
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
  const warning = stats.leave ? `<div class="kitchen-ready">🏖️ ${stats.leave} personel yıllık izin nedeniyle tabldot dışı</div>` : `<div class="kitchen-ready">✓ Varsayılan yemek listesi aktif</div>`;
  return `<article class="card kitchen-meal-card">
    <div class="kitchen-meal-head"><div><span>${meal === 'breakfast' ? '☕' : meal === 'lunch' ? '🍲' : '🍽'}</span><h3>${mealNames[meal]}</h3></div><button class="btn btn-secondary btn-sm" onclick="openCookMealDetail('${date}','${meal}')">İsim Listesi</button></div>
    <div class="kitchen-main-number"><strong>${stats.prepared}</strong><span>yemek hazırlanacak</span></div>
    <div class="kitchen-stat-grid">
      <div><strong>${stats.yes}</strong><span>Yerinde yiyecek</span></div>
      <div><strong>${stats.duty}</strong><span>Görevde / Ayrılacak</span></div>
      <div><strong>${stats.no}</strong><span>Yemeyecek</span></div>
      <div><strong>${stats.leave}</strong><span>Yıllık izin</span></div>
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
  const totalLeave = stats.reduce((sum, x) => sum + x.leave, 0);
  document.getElementById('pageContent').innerHTML = `
    <div class="kitchen-topbar">
      <div><span class="kitchen-eyebrow">GÜNLÜK MUTFAK PLANI</span><h2>${formatDayDate(date)}</h2><p>Tercih yapmayan personel varsayılan olarak yiyecek kabul edilir; Görevdeyim / Ayır da hazırlanacak sayıya dahildir.</p></div>
      <div class="calendar-actions kitchen-date-actions"><button class="btn btn-secondary btn-sm" onclick="changeCookDate(-1)">‹ Önceki Gün</button><button class="btn btn-secondary btn-sm" onclick="goTodayCookDate()">Bugün</button><input type="date" value="${date}" onchange="setCookDate(this.value)" aria-label="Mutfak tarihi"><button class="btn btn-primary btn-sm" onclick="changeCookDate(1)">Sonraki Gün ›</button></div>
    </div>
    <div class="grid grid-4 section-gap kitchen-overview">
      ${metric('🍽', 'Toplam hazırlanacak', totalPrepared + ' öğün', 'Üç öğünün toplamı')}
      ${metric('📦', 'Görev için ayrılacak', totalDuty + ' paket', 'Görevdeyim / Ayır seçimleri')}
      ${metric('👥', 'Aktif personel', approvedUsers().length + ' kişi', 'Her öğün için değerlendirilen')}
      ${metric('🏖️', 'Yıllık izin düşümü', totalLeave + ' öğün', 'Onaylı yıllık izin nedeniyle hazırlanmayacak')}
    </div>
    <div class="kitchen-meals section-gap">${['breakfast', 'lunch', 'dinner'].map(meal => kitchenMealCard(date, meal)).join('')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Günlük hazırlık özeti</h3><p>Aşçının hızlı kontrol listesi</p></div><div class="toolbar-right"><button class="btn btn-secondary btn-sm" onclick="renderCookDashboard()">↻ Yenile</button><button class="btn btn-secondary btn-sm" onclick="window.print()">Yazdır</button></div></div>
      <div class="table-wrap"><table class="kitchen-summary-table"><thead><tr><th>Öğün</th><th>Hazırlanacak</th><th>Yerinde yiyecek</th><th>Görevde / Ayrılacak</th><th>Yemeyecek</th><th>Yıllık izin</th><th>Liste</th></tr></thead><tbody>${['breakfast','lunch','dinner'].map(meal => { const x = cookMealStats(date, meal); return `<tr><td><strong>${mealNames[meal]}</strong></td><td><span class="kitchen-table-total">${x.prepared}</span></td><td>${x.yes}</td><td>${x.duty}</td><td>${x.no}</td><td>${x.leave}</td><td><button class="btn btn-secondary btn-sm" onclick="openCookMealDetail('${date}','${meal}')">İsimleri Gör</button></td></tr>`; }).join('')}</tbody></table></div>
    </div>`;
}
function openCookMealDetail(date, meal) {
  if (!hasCookPermission()) return;
  const groups = getMealStatusGroups(date, meal);
  const groupBlock = (title, users, cls) => `<section class="kitchen-name-group ${cls}"><div><strong>${title}</strong><span>${users.length} kişi</span></div>${users.length ? `<ul>${users.map(user => `<li>${escapeHtml(user.name)}<small>${escapeHtml(user.title || '')}</small></li>`).join('')}</ul>` : '<p>Personel bulunmuyor.</p>'}</section>`;
  showModal(`${formatDayDate(date)} · ${mealNames[meal]}`, `<div class="kitchen-detail-summary"><strong>${groups.yes.length + groups.duty.length}</strong><span>toplam yemek hazırlanacak</span></div><div class="kitchen-name-groups">${groupBlock('Yerinde yiyecek', groups.yes, 'yes')}${groupBlock('Görevde / Ayrılacak', groups.duty, 'duty')}${groupBlock('Yemeyecek', groups.no, 'no')}${groupBlock('Yıllık izin / Tabldot dışı', groups.leave, 'missing')}</div>`);
}

function renderMyFinance() {
  const debts = db.debts.filter(x => x.userId === currentUser.id);
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-3">${metric('₺', 'Toplam borç', money(debts.reduce((s, x) => s + x.amount, 0)), 'Dönem borçları')}${metric('✅', 'Ödenen', money(debts.reduce((s, x) => s + x.paid, 0)), 'Onaylanan ödemeler')}${metric('⏳', 'Kalan', money(debts.reduce((s, x) => s + Math.max(0, x.amount - x.paid), 0)), 'Ödeme bekleniyor')}</div>
    <div class="grid grid-2 section-gap"><div class="card"><div class="card-header"><div><h3>Ödeme bilgileri</h3><p>Havale açıklamasına ad soyad yazınız</p></div></div><div class="card-body">${db.settings.bankName ? `<label>Banka<input value="${escapeHtml(db.settings.bankName)}" readonly></label>` : ''}<label class="${db.settings.bankName ? 'section-gap' : ''}">Hesap sahibi<input value="${escapeHtml(db.settings.accountName)}" readonly></label><label class="section-gap">IBAN<input id="ibanInput" value="${escapeHtml(db.settings.iban)}" readonly></label><button class="btn btn-secondary section-gap" onclick="copyIban()">IBAN'ı Kopyala</button></div></div>
    <div class="card"><div class="card-header"><div><h3>Ödeme bildirimi</h3><p>Yaptığınız ödemeyi yönetime gönderin</p></div></div><div class="card-body"><button class="btn btn-primary" onclick="paymentModal()">Ödeme Bildir</button></div></div></div>
    <div class="card section-gap"><div class="card-header"><div><h3>Borç dökümü</h3><p>Dönem bazında ödeme durumunuz</p></div></div><div class="table-wrap"><table><thead><tr><th>Dönem</th><th>Borç</th><th>Ödenen</th><th>Kalan</th><th>Durum</th></tr></thead><tbody>${debts.map(x => `<tr><td>${x.period}</td><td>${money(x.amount)}</td><td>${money(x.paid)}</td><td><strong>${money(Math.max(0, x.amount - x.paid))}</strong></td><td>${statusBadge(x.paid >= x.amount ? 'paid' : 'unpaid')}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function paymentInfoModal() {
  if (!hasPermission('finance.manage')) return;
  showModal('Ödeme / IBAN Bilgilerini Düzenle', `<form id="paymentInfoForm" class="form-grid">
    <label class="span-2">Banka adı<input name="bankName" value="${escapeHtml(db.settings.bankName || '')}" placeholder="Örn. Ziraat Bankası"></label>
    <label class="span-2">Hesap sahibi<input name="accountName" value="${escapeHtml(db.settings.accountName || '')}" required></label>
    <label class="span-2">IBAN<input name="iban" value="${escapeHtml(db.settings.iban || '')}" required></label>
    <div class="span-2"><button class="btn btn-primary btn-block">Ödeme Bilgilerini Kaydet</button></div>
  </form>`);
  document.getElementById('paymentInfoForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target);
    const before = `${db.settings.bankName || ''} | ${db.settings.accountName || ''} | ${db.settings.iban || ''}`;
    db.settings.bankName = String(f.get('bankName') || '').trim();
    db.settings.accountName = String(f.get('accountName') || '').trim();
    db.settings.iban = String(f.get('iban') || '').trim();
    logAudit('finance.payment_info', `Ödeme bilgileri güncellendi: ${before} → ${db.settings.bankName} | ${db.settings.accountName} | ${db.settings.iban}`);
    saveDB(); closeModal(); renderFinanceManagement(); toast('IBAN ve hesap bilgileri güncellendi.');
  });
}

function renderFinanceManagement() {
  if (!hasPermission('finance.manage')) return goPage('dashboard');
  const now = new Date();
  const period = db.settings.balancePeriod || `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
  const [py,pm]=period.split('-').map(Number), lastDay=new Date(py,pm,0).getDate();
  const start=`${py}-${pad(pm)}-01`, end=`${py}-${pad(pm)}-${pad(lastDay)}`;
  const periodExpenses=db.expenses.filter(x=>x.date>=start&&x.date<=end);
  const totalExpense=periodExpenses.reduce((a,x)=>a+Number(x.amount||0),0);
  const users=approvedUsers();
  const personMeals=users.map(user=>{
    let count=0;
    dateRange(start,end).forEach(date=>['breakfast','lunch','dinner'].forEach(meal=>{
      if(['yes','duty'].includes(effectiveMealStatus(user.id,date,meal))) count++;
    }));
    return {user,count};
  });
  const totalMeals=personMeals.reduce((a,x)=>a+x.count,0);
  const unit=totalMeals?totalExpense/totalMeals:0;
  const periodLabel=new Intl.DateTimeFormat('tr-TR',{month:'long',year:'numeric'}).format(new Date(py,pm-1,1));
  const existingDebts=db.debts.filter(x=>x.period===periodLabel);
  document.getElementById('pageContent').innerHTML=`
    <div class="card"><div class="card-header calendar-toolbar"><div><h3>Tabldot Bilanço · ${periodLabel}</h3><p>Malzeme giderleri ücretli öğünlere dağıtılır. Tercih yapmayan personel varsayılan olarak yemek yiyecek kabul edilir.</p></div><div class="calendar-actions"><input id="balancePeriodInput" type="month" value="${period}" onchange="setBalancePeriod(this.value)"><button class="btn btn-secondary btn-sm" onclick="paymentInfoModal()">IBAN / Hesap</button><button class="btn btn-secondary btn-sm" onclick="expenseModal()">Malzeme / Gider Ekle</button><button class="btn btn-primary btn-sm" onclick="calculateBalanceDebts()">Borçları Hesapla</button><button class="btn btn-secondary btn-sm" onclick="printBalance()">PDF / Yazdır</button></div></div></div>
    <div class="grid grid-4 section-gap">
      ${metric('🧾','Toplam malzeme gideri',money(totalExpense),periodExpenses.length+' kalem')}
      ${metric('🍽','Toplam ücretli öğün',totalMeals,'Yıllık izin düşümleri hariç')}
      ${metric('₺','Öğün birim maliyeti',money(unit),'Gider / toplam öğün')}
      ${metric('👥','Borçlandırılacak personel',personMeals.filter(x=>x.count>0).length+' kişi','Öğün kullanan personel')}
    </div>
    <div class="grid grid-2 section-gap">
      <div class="card"><div class="card-header"><div><h3>Alınan malzemeler / giderler</h3><p>${formatShortDate(start)} – ${formatShortDate(end)}</p></div></div><div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Malzeme / Açıklama</th><th>Tutar</th><th>İşlem</th></tr></thead><tbody>${periodExpenses.map(x=>`<tr><td>${formatShortDate(x.date)}</td><td>${escapeHtml(x.name)}</td><td><strong>${money(x.amount)}</strong></td><td><button class="btn btn-secondary btn-sm" onclick="editExpenseModal(${x.id})">Düzenle</button> <button class="btn btn-danger btn-sm" onclick="deleteExpense(${x.id})">Sil</button></td></tr>`).join('')||'<tr><td colspan="4">Bu dönemde gider kaydı yok.</td></tr>'}</tbody></table></div></div>
      <div class="card"><div class="card-header"><div><h3>Personel tabldot hesabı</h3><p>Kişi borcu = ücretli öğün × birim maliyet</p></div></div><div class="table-wrap"><table><thead><tr><th>Personel</th><th>Öğün</th><th>Hesaplanan tutar</th><th>Kayıtlı borç</th></tr></thead><tbody>${personMeals.map(x=>{const d=existingDebts.find(d=>d.userId===x.user.id);return `<tr><td>${escapeHtml(x.user.name)}</td><td>${x.count}</td><td>${money(x.count*unit)}</td><td>${d?money(d.amount):'—'}</td></tr>`}).join('')}</tbody></table></div></div>
    </div>
    <div class="card section-gap"><div class="card-header"><div><h3>Ödeme ve tahsilat</h3><p>Onaylanan ödemeler ve dönem borçları</p></div></div><div class="table-wrap"><table><thead><tr><th>Personel</th><th>Dönem</th><th>Borç</th><th>Ödenen</th><th>Kalan</th><th>Durum</th></tr></thead><tbody>${db.debts.filter(x=>x.period===periodLabel).map(x=>`<tr><td>${escapeHtml(getUser(x.userId)?.name||'-')}</td><td>${escapeHtml(x.period)}</td><td>${money(x.amount)}</td><td>${money(x.paid)}</td><td>${money(Math.max(0,x.amount-x.paid))}</td><td>${statusBadge(x.paid>=x.amount?'paid':'unpaid')}</td></tr>`).join('')||'<tr><td colspan="6">Bu dönem borçları henüz hesaplanmadı.</td></tr>'}</tbody></table></div></div>`;
}

function setBalancePeriod(value) {
  if(!value)return;
  db.settings.balancePeriod=value;
  saveDB();renderFinanceManagement();
}
function calculateBalanceDebts() {
  if(!hasPermission('finance.manage'))return;
  const period=db.settings.balancePeriod||`${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}`;
  const [py,pm]=period.split('-').map(Number),lastDay=new Date(py,pm,0).getDate();
  const start=`${py}-${pad(pm)}-01`,end=`${py}-${pad(pm)}-${pad(lastDay)}`;
  const label=new Intl.DateTimeFormat('tr-TR',{month:'long',year:'numeric'}).format(new Date(py,pm-1,1));
  const totalExpense=db.expenses.filter(x=>x.date>=start&&x.date<=end).reduce((a,x)=>a+Number(x.amount||0),0);
  const rows=approvedUsers().map(user=>{let count=0;dateRange(start,end).forEach(date=>['breakfast','lunch','dinner'].forEach(meal=>{if(['yes','duty'].includes(effectiveMealStatus(user.id,date,meal)))count++;}));return{user,count};});
  const totalMeals=rows.reduce((a,x)=>a+x.count,0),unit=totalMeals?totalExpense/totalMeals:0;
  rows.forEach(x=>{
    const amount=Number((x.count*unit).toFixed(2));
    let d=db.debts.find(d=>d.userId===x.user.id&&d.period===label);
    if(d)d.amount=amount;else db.debts.push({id:Date.now()+x.user.id,userId:x.user.id,period:label,amount,paid:0});
  });
  logAudit('balance.calculate',`${label}: ${money(totalExpense)} / ${totalMeals} öğün = ${money(unit)}`);
  saveDB();renderFinanceManagement();toast('Tabldot borçları hesaplandı ve personele yansıtıldı.');
}
function printBalance() {
  const old=document.title;document.title=`PBYS_Tabldot_Bilanco_${db.settings.balancePeriod||''}`;window.print();document.title=old;
}

function copyIban() { navigator.clipboard?.writeText(db.settings.iban); toast('IBAN panoya kopyalandı.'); }
function paymentModal() {
  showModal('Ödeme Bildir', `<form id="paymentForm" class="form-grid"><label>Dönem<select name="period"><option>Ağustos 2026</option></select></label><label>Tutar<input name="amount" type="number" required></label><label>Ödeme tarihi<input name="date" type="date" value="${toISO(new Date())}" required></label><label>Dekont<input name="receipt" type="file" accept="image/*,.pdf"></label><div class="span-2"><button class="btn btn-primary btn-block">Bildirimi Gönder</button></div></form>`);
  document.getElementById('paymentForm').addEventListener('submit', e => { e.preventDefault(); const f = new FormData(e.target); db.payments.push({ id: Date.now(), userId: currentUser.id, period: f.get('period'), amount: Number(f.get('amount')), date: f.get('date'), status: 'pending' }); saveDB(); closeModal(); toast('Ödeme bildiriminiz onaya gönderildi.'); });
}
function approvePayment(id) { if (!hasPermission('finance.manage')) return; const p = db.payments.find(x => x.id === id); if (!p) return; p.status = 'approved'; const d = db.debts.find(x => x.userId === p.userId && x.period === p.period); if (d) d.paid = Math.min(d.amount, d.paid + p.amount); saveDB(); renderFinanceManagement(); toast('Ödeme onaylandı.'); }

function getRemainingLeave(user) {
  return Math.max(0, Number(user.annualAllowance ?? 30) - Number(user.usedLeave || 0) - getApprovedAnnualDays(user.id));
}
function monthTitle(year, month) { return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1)); }
function changeLeaveMonth(delta) { leaveCalendarCursor = new Date(leaveCalendarCursor.getFullYear(), leaveCalendarCursor.getMonth() + delta, 1); renderLeaveManagement(); }
function goCurrentLeaveMonth() { leaveCalendarCursor = startOfMonth(new Date()); renderLeaveManagement(); }
function renderMyLeaves() {
  const own = db.leaveRequests.filter(x => x.userId === currentUser.id).sort((a, b) => b.start.localeCompare(a.start));
  const usedAnnual = Number(currentUser.usedLeave || 0) + getApprovedAnnualDays(currentUser.id, false);
  const usedRoad = Number(currentUser.usedRoadLeave || 0) + getApprovedRoadDays(currentUser.id, false);
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-4">
      ${metric('📅', 'Yıllık izin hakkı', (currentUser.annualAllowance ?? 30) + ' gün', 'Temel hak')}
      ${metric('✅', 'Kullanılan yıllık', usedAnnual + ' gün', 'Geçmiş kesinleşen kullanım')}
      ${metric('⏳', 'Kalan yıllık', getRemainingLeave(currentUser) + ' gün', 'Onaylı izinler düşülmüştür')}
      ${metric('🛣️', 'Yol izni', getRoadRemaining(currentUser) + ' / ' + (currentUser.roadAllowance ?? 2) + ' gün', 'Kullanılan: ' + usedRoad + ' gün')}
    </div>
    <div class="card section-gap"><div class="card-header"><div><h3>İzinlerim</h3><p>İzin geçmişiniz ve talepleriniz</p></div>${!isCommander() ? '<button class="btn btn-primary btn-sm" onclick="leaveModal()">Yeni İzin Talebi</button>' : ''}</div>${own.length ? leaveTable(own, false) : '<div class="empty">Henüz izin kaydınız bulunmuyor.</div>'}</div>`;
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
    <div class="card section-gap"><div class="card-header"><div><h3>${monthTitle(year, month)} izinli personel listesi</h3><p>Gösterilen ayla kesişen bütün izinler</p></div>${hasPermission('leave.manage') ? '<button class="btn btn-secondary btn-sm" onclick="leaveModal(true)">Geçmiş İzin / Kayıt Ekle</button>' : ''}</div>${monthly.length ? leaveTable(monthly, true) : '<div class="empty">Bu ay için izin kaydı bulunmuyor.</div>'}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Tüm izin talepleri</h3><p>Personel adına tıklayarak bütün izin geçmişini açabilirsiniz</p></div></div>${leaveTable(db.leaveRequests, true)}</div>`;
}
function canEditOwnLeave(request) {
  return !!request && request.userId === currentUser?.id && request.status === 'pending';
}
function canDeleteOwnLeave(request) {
  return !!request && request.userId === currentUser?.id && ['pending','rejected'].includes(request.status);
}
function leaveTable(items, actions, compact = false) {
  const hasOwnEditable = items.some(x => canEditOwnLeave(x) || canDeleteOwnLeave(x));
  const showActionColumn = actions || hasOwnEditable;
  return `<div class="table-wrap"><table><thead><tr><th>Personel</th><th>İzin türü</th><th>Başlangıç</th><th>Bitiş</th><th>Gün</th>${compact ? '' : '<th>Şehir</th>'}<th>Durum</th>${showActionColumn ? '<th>İşlem</th>' : ''}</tr></thead><tbody>${items.map(x => {
    const ownEdit = `${canEditOwnLeave(x) ? `<button class="btn btn-secondary btn-sm" onclick="leaveModal(false, ${x.id})">Düzenle</button>` : ''}${canDeleteOwnLeave(x) ? ` <button class="btn btn-danger btn-sm" onclick="deleteLeaveRequest(${x.id})">Sil / İptal Et</button>` : ''}`.trim();
    const managerDelete = actions && hasPermission('leave.manage') ? `<button class="btn btn-danger btn-sm" onclick="deleteLeaveRequest(${x.id}, true)">Sil</button>` : '';
    const managementActions = actions && x.status === 'pending' && (hasPermission('leave.approve') || hasPermission('leave.manage'))
      ? `<button class="btn btn-success btn-sm" onclick="approveLeave(${x.id})">Onayla</button> <button class="btn btn-danger btn-sm" onclick="rejectLeave(${x.id})">Reddet</button>`
      : '';
    const actionCell = [ownEdit, managementActions, managerDelete].filter(Boolean).join(' ') || '—';
    return `<tr><td>${(hasPermission('personnel.view') || hasPermission('leave.view')) ? `<button class="person-link" onclick="openPersonnelLeaves(${x.userId})">${escapeHtml(getUser(x.userId)?.name || '-')}</button>` : `<strong>${escapeHtml(getUser(x.userId)?.name || '-')}</strong>`}</td><td>${escapeHtml(x.type)}</td><td>${formatDate(x.start)}</td><td>${formatDate(x.end)}</td><td>${x.days}</td>${compact ? '' : `<td>${escapeHtml(x.city || '-')}</td>`}<td>${statusBadge(x.status)}</td>${showActionColumn ? `<td>${actionCell}</td>` : ''}</tr>`;
  }).join('')}</tbody></table></div>`;
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
  const preference = db.leavePreferences.find(x => x.userId === userId && x.year === db.settings.leavePlanYear);
  showModal(`${user.name} · Personel ve İzin Bilgileri`, `
    <div class="grid grid-4 compact-metrics">
      ${metric('📅', 'Yıllık hak', (user.annualAllowance ?? 30) + ' gün', 'Tanımlı hak')}
      ${metric('⏳', 'Yıllık kalan', getRemainingLeave(user) + ' gün', 'Onaylı kayıtlar düşülmüş')}
      ${metric('🛣️', 'Yol izni hakkı', (user.roadAllowance ?? 2) + ' gün', 'Ayrı bakiye')}
      ${metric('🛣️', 'Yol izni kalan', getRoadRemaining(user) + ' gün', 'Onaylı kayıtlar düşülmüş')}
    </div>
    <div class="person-summary section-gap"><div><strong>Rol</strong><span>${escapeHtml(userRoleLabels(user))}</span></div>${hasPermission('leave.plan') ? `<div><strong>Planlama puanı</strong><span>${user.planningScore ?? 0}</span></div>` : ''}<div><strong>${db.settings.leavePlanYear} tercihi</strong><span>${preference ? 'Gönderildi' : 'Gönderilmedi'}</span></div></div>
    ${preference ? `<div class="preference-summary section-gap"><div><strong>1. tercih</strong><span>${formatDate(preference.firstStart)} – ${formatDate(preference.firstEnd)}</span></div><div><strong>2. tercih</strong><span>${formatDate(preference.secondStart)} – ${formatDate(preference.secondEnd)}</span></div></div>` : ''}
    <div class="section-gap"><h3>Tüm izin kayıtları</h3>${records.length ? leaveTable(records, false, true) : '<div class="empty">Bu personele ait izin kaydı bulunmuyor.</div>'}</div>`);
}
function leaveModal(asManager = false, editId = null) {
  if (!asManager && isCommander()) return toast('Karakol Komutanı için yeni izin talebi bu sistemden oluşturulmaz.');
  const users = approvedUsers();
  const editing = editId ? db.leaveRequests.find(x => x.id === Number(editId)) : null;
  if (editing && (asManager || !canEditOwnLeave(editing))) return toast('Bu izin talebi artık personel tarafından düzenlenemez.');
  const selectedType = editing?.type || 'Yıllık İzin';
  const types = ['Yıllık İzin','Günübirlik İzin','Mazeret İzni','Sağlık İzni','Görev / Kurs','Yol İzni'];
  const title = editing ? 'İzin Talebini Düzenle' : (asManager ? 'Geçmiş / Yönetici İzin Kaydı Ekle' : 'Yeni İzin Talebi');
  showModal(title, `<form id="leaveForm" class="form-grid">
    ${asManager ? `<label class="span-2">Personel<select name="userId">${users.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('')}</select></label>` : ''}
    <label>İzin türü<select name="type">${types.map(type => `<option${type === selectedType ? ' selected' : ''}>${type}</option>`).join('')}</select></label>
    <label>İzne gidilecek şehir<input name="city" value="${escapeHtml(editing?.city || '')}" ${asManager ? '' : 'required'}></label>
    <label>Başlangıç tarihi<input name="start" type="date" value="${editing?.start || ''}" required></label>
    <label>Bitiş tarihi<input name="end" type="date" value="${editing?.end || ''}" required></label>
    <label class="span-2">Açıklama<textarea name="note">${escapeHtml(editing?.note || '')}</textarea></label>
    ${asManager ? '<div class="span-2 form-hint">Admin/İdari İşler geçmiş aylarda kullanılmış izinleri buradan ekleyebilir. Kayıt onaylı olarak işlenir ve bakiyeyi otomatik etkiler.</div>' : ''}
    <div class="span-2"><button class="btn btn-primary btn-block">${editing ? 'Değişiklikleri Kaydet' : (asManager ? 'İzin Kaydını Ekle' : 'Talebi Gönder')}</button></div>
  </form>`);
  document.getElementById('leaveForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target), start = f.get('start'), end = f.get('end'), type = f.get('type');
    if (end < start) return toast('Bitiş tarihi başlangıçtan önce olamaz.');
    if (type === 'Günübirlik İzin' && start !== end) return toast('Günübirlik izin için başlangıç ve bitiş aynı gün olmalıdır.');
    const payload = { type, city: f.get('city') || '-', start, end, days: daysBetween(start, end), note: f.get('note') };
    if (editing) {
      Object.assign(editing, payload, { status: 'pending', updatedAt: new Date().toISOString() });
      logAudit('leave_request_updated', `${currentUser.name} izin talebini güncelledi: ${start} - ${end}`);
    } else {
      const record = { id: Date.now(), userId: asManager ? Number(f.get('userId')) : currentUser.id, ...payload, status: asManager ? 'approved' : 'pending', source: asManager ? 'historical-or-manager' : 'request', createdAt: new Date().toISOString() };
      db.leaveRequests.push(record);
      logAudit(asManager ? 'leave_historical_created' : 'leave_request_created', `${getUser(record.userId)?.name || currentUser.name}: ${type} ${start} - ${end}`);
    }
    saveDB(); closeModal(); asManager ? renderLeaveManagement() : renderMyLeaves(); toast(editing ? 'İzin talebiniz güncellendi.' : (asManager ? 'İzin kaydı eklendi ve bakiye güncellendi.' : 'İzin talebiniz onaya gönderildi.'));
  });
}
function deleteLeaveRequest(id, asManager = false) {
  const x = db.leaveRequests.find(r => r.id === Number(id));
  if (!x) return;
  const ownAllowed = x.userId === currentUser?.id && ['pending','rejected'].includes(x.status);
  const managerAllowed = asManager && hasPermission('leave.manage');
  if (!ownAllowed && !managerAllowed) return toast('Bu izin kaydını silme yetkiniz yok.');
  if (x.status === 'approved' && !managerAllowed) return toast('Onaylanmış izin personel tarafından silinemez.');
  const userName = getUser(x.userId)?.name || 'Personel';
  if (!confirm(`${userName} için ${formatShortDate(x.start)} - ${formatShortDate(x.end)} izin kaydı silinsin mi?`)) return;
  db.leaveRequests = db.leaveRequests.filter(r => r.id !== Number(id));
  logAudit('leave.delete', `${userName}: ${x.type} ${x.start} - ${x.end} (${x.status}) silindi`);
  saveDB();
  if (currentPage === 'leave-management') renderLeaveManagement(); else renderMyLeaves();
  toast('İzin kaydı silindi.');
}

function approveLeave(id) {
  if (!hasPermission('leave.approve') && !hasPermission('leave.manage')) return;
  const x=db.leaveRequests.find(r=>r.id===id); if(!x)return;
  if(x.type==='Yıllık İzin'){
    const capacity=concurrentLeaveCapacity();
    const blocked=dateRange(x.start,x.end).find(date=>{
      const count=db.leaveRequests.filter(r=>r.id!==x.id&&r.status==='approved'&&r.type==='Yıllık İzin'&&r.start<=date&&r.end>=date).length;
      return count>=capacity;
    });
    if(blocked) return toast(`${formatShortDate(blocked)} tarihinde eşzamanlı izin sınırı (${capacity} kişi) dolu.`);
  }
  x.status='approved'; x.approvedAt=new Date().toISOString(); x.approvedBy=currentUser.id;
  logAudit('leave.approve',`${getUser(x.userId)?.name||x.userId}: ${x.start} - ${x.end}`);
  saveDB(); renderLeaveManagement(); toast('İzin talebi onaylandı.');
}
function rejectLeave(id) { if (!hasPermission('leave.approve') && !hasPermission('leave.manage')) return; const x = db.leaveRequests.find(r => r.id === id); if (x) { x.status = 'rejected'; saveDB(); renderLeaveManagement(); toast('İzin talebi reddedildi.'); } }

function renderMyLeavePreference() {
  const year = db.settings.leavePlanYear;
  const preference = db.leavePreferences.find(x => x.userId === currentUser.id && x.year === year);
  const result = db.leavePlanResults.find(x => x.userId === currentUser.id && x.year === year && x.announced);
  const firstStart = preference?.firstStart || '';
  const secondStart = preference?.secondStart || '';
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-2">${metric('🗓', 'Planlama yılı', year, 'Yönetim tarafından belirlenir')}${metric('📌', 'Planlama sonucu', result ? resultLabel(result) : 'Değerlendirme bekleniyor', result ? 'Sonuç yönetim tarafından açıklandı' : 'Puan ve iç değerlendirme personele gösterilmez')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>${year} yıllık izin tercih formu</h3><p>Ocak-Mayıs ve Ekim-Aralık başlangıçları 10 gün; Haziran-Eylül başlangıçları 20 gün olarak otomatik hesaplanır.</p></div></div><div class="card-body">
      ${preference?.status === 'reselect' ? '<div class="management-banner"><strong>Tekrar tercih istendi</strong><span>Yönetim önceki tercihlerinizi yeniden düzenlemenizi istiyor.</span></div>' : ''}
      <form id="preferenceForm" class="form-grid section-gap">
        <div class="span-2 preference-heading"><strong>1. Tercih</strong><span>Öncelikli izin dönemi</span></div>
        <label>Başlangıç<input id="firstStartInput" name="firstStart" type="date" value="${firstStart}" required></label>
        <label>Bitiş (otomatik)<input id="firstEndInput" name="firstEnd" type="date" value="${firstStart ? preferenceEndForStart(firstStart) : ''}" readonly></label>
        <div class="span-2 preference-heading"><strong>2. Tercih</strong><span>Birinci tercih uygun olmazsa değerlendirilecek dönem</span></div>
        <label>Başlangıç<input id="secondStartInput" name="secondStart" type="date" value="${secondStart}" required></label>
        <label>Bitiş (otomatik)<input id="secondEndInput" name="secondEnd" type="date" value="${secondStart ? preferenceEndForStart(secondStart) : ''}" readonly></label>
        <label class="span-2">Açıklama<textarea name="note" placeholder="Varsa planlamada dikkate alınmasını istediğiniz husus">${escapeHtml(preference?.note || '')}</textarea></label>
        <div class="span-2"><button class="btn btn-primary btn-block">Tercihlerimi Kaydet</button></div>
      </form>
    </div></div>
    ${preference ? `<div class="card section-gap"><div class="card-header"><div><h3>Gönderilen tercihler</h3><p>Tercihler yönetim değerlendirmesine alınır.</p></div>${statusBadge(preference.status === 'reselect' ? 'warning' : 'submitted')}</div><div class="card-body preference-summary"><div><strong>1. tercih</strong><span>${formatDate(preference.firstStart)} – ${formatDate(preference.firstEnd)} · ${daysBetween(preference.firstStart, preference.firstEnd)} gün</span></div><div><strong>2. tercih</strong><span>${formatDate(preference.secondStart)} – ${formatDate(preference.secondEnd)} · ${daysBetween(preference.secondStart, preference.secondEnd)} gün</span></div></div></div>` : ''}`;
  const syncEnds = () => {
    const a=document.getElementById('firstStartInput'), b=document.getElementById('secondStartInput');
    if (a) document.getElementById('firstEndInput').value = a.value ? preferenceEndForStart(a.value) : '';
    if (b) document.getElementById('secondEndInput').value = b.value ? preferenceEndForStart(b.value) : '';
  };
  document.getElementById('firstStartInput')?.addEventListener('change',syncEnds);
  document.getElementById('secondStartInput')?.addEventListener('change',syncEnds);
  document.getElementById('preferenceForm').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target);
    const firstStart=f.get('firstStart'), secondStart=f.get('secondStart');
    const firstEnd=preferenceEndForStart(firstStart), secondEnd=preferenceEndForStart(secondStart);
    if (![firstStart,firstEnd,secondStart,secondEnd].every(x => Number(x.slice(0,4)) === Number(year))) return toast(`Bütün tercihler ${year} yılı içinde olmalıdır.`);
    const existing = db.leavePreferences.find(x => x.userId === currentUser.id && x.year === year);
    const payload = { userId: currentUser.id, year, firstStart, firstEnd, secondStart, secondEnd, note:f.get('note'), submittedAt:toISO(new Date()), status:'submitted', revision:(existing?.revision || 0) + 1 };
    if (existing) Object.assign(existing,payload); else db.leavePreferences.push({id:Date.now(),...payload});
    db.leavePlanResults = db.leavePlanResults.filter(x => !(x.year===year && x.userId===currentUser.id));
    saveDB(); renderMyLeavePreference(); toast('Yıllık izin tercihleriniz yönetim değerlendirmesine gönderildi.');
  });
}
function resultLabel(result) {
  if (result.status === 'accepted' && result.choice === 1) return '1. tercihiniz kabul edildi';
  if (result.status === 'accepted' && result.choice === 2) return '2. tercihiniz kabul edildi';
  if (result.status === 'reselect') return 'Tekrar tercih isteniyor';
  return 'Değerlendirme sürüyor';
}
function renderLeavePlanning() {
  if (!hasPermission('leave.plan')) return goPage('dashboard');
  const year = db.settings.leavePlanYear;
  const users = planningUsers();
  const preferences = db.leavePreferences.filter(x => x.year === year);
  const results = db.leavePlanResults.filter(x => x.year === year);
  const capacity = concurrentLeaveCapacity();
  const monthCounts = Array.from({length:12},(_,i)=>({month:i,first:0,second:0}));
  preferences.forEach(p => { monthCounts[parseISO(p.firstStart).getMonth()].first++; monthCounts[parseISO(p.secondStart).getMonth()].second++; });
  const maxCount = Math.max(1,...monthCounts.flatMap(x=>[x.first,x.second]));
  const charts = monthCounts.map(x=>`<div class="survey-month"><strong>${new Intl.DateTimeFormat('tr-TR',{month:'long'}).format(new Date(year,x.month,1))}</strong><div class="survey-bar-row"><span>1.</span><div class="survey-bar"><i style="width:${Math.round(x.first/maxCount*100)}%"></i></div><b>${x.first}</b></div><div class="survey-bar-row second"><span>2.</span><div class="survey-bar"><i style="width:${Math.round(x.second/maxCount*100)}%"></i></div><b>${x.second}</b></div></div>`).join('');
  const rows = users.slice().sort((a,b)=>(b.planningScore??0)-(a.planningScore??0)||a.name.localeCompare(b.name,'tr')).map(user=>{
    const p=preferences.find(x=>x.userId===user.id), r=results.find(x=>x.userId===user.id);
    const h1=p?rangeHolidayNames(p.firstStart,p.firstEnd,year):[], h2=p?rangeHolidayNames(p.secondStart,p.secondEnd,year):[];
    const holiday = [...new Set([...h1,...h2])];
    const cls=holiday.length?'holiday-hit':'';
    return `<tr class="${cls}"><td><button class="person-link" onclick="openPersonnelLeaves(${user.id})">${escapeHtml(user.name)}</button><small class="table-sub">${escapeHtml(user.title||'')}</small></td><td><strong>${user.planningScore??0}</strong></td><td>${p?`${formatShortDate(p.firstStart)} – ${formatShortDate(p.firstEnd)}${h1.length?`<small class="holiday-note">🎉 ${escapeHtml(h1.join(', '))}</small>`:''}`:'—'}</td><td>${p?`${formatShortDate(p.secondStart)} – ${formatShortDate(p.secondEnd)}${h2.length?`<small class="holiday-note">🎉 ${escapeHtml(h2.join(', '))}</small>`:''}`:'—'}</td><td>${p?statusBadge(p.status==='reselect'?'warning':'submitted'):statusBadge('unsubmitted')}</td><td>${r ? `${r.choice ? r.choice+'. tercih' : '—'} · ${r.status==='accepted'?'Kabul':r.status==='reselect'?'Tekrar tercih':'Taslak'}` : '—'}</td><td>${p?`<button class="btn btn-success btn-sm" onclick="acceptLeavePreference(${user.id},1)">1. Tercihi Kabul</button> <button class="btn btn-success btn-sm" onclick="acceptLeavePreference(${user.id},2)">2. Tercihi Kabul</button> <button class="btn btn-warning btn-sm" onclick="requestPreferenceAgain(${user.id})">Tekrar Tercih İste</button>`:'—'}</td></tr>`;
  }).join('');
  document.getElementById('pageContent').innerHTML=`
    <div class="grid grid-4">${metric('🗓','Planlama yılı',year,'Yıllık genel plan')}${metric('📨','Tercih veren',preferences.length+' / '+users.length,'Sonuçlar topluca değerlendirilir')}${metric('📏','Eşzamanlı izin sınırı',capacity+' kişi','Aktif personelin %'+(db.settings.leaveConcurrentPercent||25)+'\'i')}${metric('⭐','Puanlama','Yönetim içi','Personel puanı görmez')}</div>
    <div class="card section-gap"><div class="card-header"><div><h3>Yıllık izin anket sonucu</h3><p>Ay bazında 1. ve 2. tercih yoğunluğu</p></div></div><div class="card-body"><div class="survey-chart">${charts}</div></div></div>
    <div class="card section-gap"><div class="card-header"><div><h3>${year} Türkiye resmî tatilleri</h3><p>Tatil dönemine denk gelen tercihler tabloda vurgulanır.</p></div></div><div class="card-body holiday-list">${holidaysForYear(year).map(h=>`<span><strong>${escapeHtml(h.name)}</strong> ${formatShortDate(h.start)}${h.end!==h.start?' – '+formatShortDate(h.end):''}</span>`).join('')}</div></div>
    <div class="card section-gap"><div class="card-header"><div><h3>Personel tercih değerlendirmesi</h3><p>Önce tercihler toplanır; Karakol Komutanı/Admin değerlendirir ve sonra sonuç açıklanır. Yıl içindeki gerçek tarihler ayrıca revize edilecektir.</p></div><div class="calendar-actions"><button class="btn btn-primary btn-sm" onclick="generateLeavePlan()">Otomatik Taslak Oluştur</button><button class="btn btn-success btn-sm" onclick="announceLeavePlan()">Sonuçları Açıkla</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Personel</th><th>İç Puan</th><th>1. Tercih</th><th>2. Tercih</th><th>Durum</th><th>Karar</th><th>İşlem</th></tr></thead><tbody>${rows}</tbody></table></div>
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
  const year=db.settings.leavePlanYear, capacity=concurrentLeaveCapacity(), occupancy={};
  const ordered=planningUsers().slice().sort((a,b)=>(b.planningScore??0)-(a.planningScore??0)||a.name.localeCompare(b.name,'tr'));
  const results=[];
  ordered.forEach(user=>{
    const p=db.leavePreferences.find(x=>x.userId===user.id&&x.year===year&&x.status!=='reselect'); if(!p)return;
    if(canAllocate(p.firstStart,p.firstEnd,occupancy,capacity)){occupyRange(p.firstStart,p.firstEnd,occupancy);results.push({id:Date.now()+user.id,userId:user.id,year,choice:1,start:p.firstStart,end:p.firstEnd,score:user.planningScore??0,status:'draft',announced:false});}
    else if(canAllocate(p.secondStart,p.secondEnd,occupancy,capacity)){occupyRange(p.secondStart,p.secondEnd,occupancy);results.push({id:Date.now()+user.id,userId:user.id,year,choice:2,start:p.secondStart,end:p.secondEnd,score:user.planningScore??0,status:'draft',announced:false});}
    else results.push({id:Date.now()+user.id,userId:user.id,year,choice:0,start:'',end:'',score:user.planningScore??0,status:'reselect',announced:false});
  });
  db.leavePlanResults=db.leavePlanResults.filter(x=>x.year!==year).concat(results);
  saveDB();renderLeavePlanning();toast('Eşzamanlı %25 sınırı ve puan sırasına göre yıllık plan taslağı oluşturuldu.');
}
function publishLeavePlan() { announceLeavePlan(); }
function acceptLeavePreference(userId, choice) {
  if (!hasPermission('leave.plan')) return;
  const year=db.settings.leavePlanYear, p=db.leavePreferences.find(x=>x.userId===Number(userId)&&x.year===year); if(!p)return;
  const start=choice===1?p.firstStart:p.secondStart, end=choice===1?p.firstEnd:p.secondEnd;
  const result=db.leavePlanResults.find(x=>x.userId===Number(userId)&&x.year===year);
  const payload={id:result?.id||Date.now()+Number(userId),userId:Number(userId),year,choice,start,end,score:getUser(userId)?.planningScore??0,status:'accepted',announced:false};
  if(result)Object.assign(result,payload);else db.leavePlanResults.push(payload);
  saveDB();renderLeavePlanning();toast(`${choice}. tercih kabul edildi. Sonuç açıklanana kadar personele gösterilmez.`);
}
function requestPreferenceAgain(userId) {
  if (!hasPermission('leave.plan')) return;
  const year=db.settings.leavePlanYear, p=db.leavePreferences.find(x=>x.userId===Number(userId)&&x.year===year); if(!p)return;
  p.status='reselect';
  const old=db.leavePlanResults.find(x=>x.userId===Number(userId)&&x.year===year);
  if(old)Object.assign(old,{choice:0,start:'',end:'',status:'reselect',announced:false});
  else db.leavePlanResults.push({id:Date.now()+Number(userId),userId:Number(userId),year,choice:0,start:'',end:'',status:'reselect',announced:false});
  saveDB();renderLeavePlanning();toast('Personelden tekrar yıllık izin tercihi istendi.');
}
function announceLeavePlan() {
  if (!hasPermission('leave.plan')) return;
  const year=db.settings.leavePlanYear;
  const submitted=db.leavePreferences.filter(x=>x.year===year&&x.status!=='reselect').length;
  if(submitted < planningUsers().length) return toast(`Sonuçlar açıklanamaz: ${planningUsers().length-submitted} personel henüz yıllık izin tercihi vermedi.`);
  db.leavePlanResults.filter(x=>x.year===year).forEach(r=>{
    r.announced=true;
    if(r.status==='draft') r.status='accepted';
    const user=getUser(r.userId);
    if(user && r.choice===2 && !r.scoreBonusApplied){ user.planningScore=(user.planningScore??0)+Number(db.settings.planningSecondChoiceBonus||20); r.scoreBonusApplied=true; }
    if(user && r.choice===1 && !r.scoreBonusApplied){ user.planningScore=(user.planningScore??0)+Number(db.settings.planningFirstChoiceBonus||0); r.scoreBonusApplied=true; }
  });
  saveDB();renderLeavePlanning();toast('Yıllık izin planlama sonuçları personele açıklandı.');
}
function machineStatusModal(machine) {
  if (!isAdmin()) return toast('Cihaz durumunu yalnızca Admin değiştirebilir.');
  const current = db.settings.laundryMachineStatus?.[machine] || 'active';
  showModal(`${machine} · Cihaz Durumu`, `<form id="machineStatusForm">
    <label>Durum<select name="status"><option value="active" ${current==='active'?'selected':''}>Aktif</option><option value="broken" ${current==='broken'?'selected':''}>Arızalı</option><option value="maintenance" ${current==='maintenance'?'selected':''}>Bakımda</option></select></label>
    <button class="btn btn-primary btn-block section-gap">Durumu Kaydet</button>
  </form>`);
  document.getElementById('machineStatusForm').addEventListener('submit', e => {
    e.preventDefault(); const next = new FormData(e.target).get('status');
    const before = db.settings.laundryMachineStatus[machine] || 'active';
    db.settings.laundryMachineStatus[machine] = next;
    logAudit('laundry.machine_status', `${machine}: ${before} → ${next}`);
    saveDB(); closeModal(); renderLaundry(); toast(`${machine} durumu güncellendi.`);
  });
}

function renderLaundry() {
  const date=toISO(new Date()), times=['09:00','10:30','12:00','13:30','15:00','16:30','18:00','19:30','21:00'];
  const machines=['Beyaz Çamaşır Makinesi','Gri Çamaşır Makinesi','Kurutma Makinesi'];
  db.settings.laundryMachineStatus ||= {'Beyaz Çamaşır Makinesi':'active','Gri Çamaşır Makinesi':'active','Kurutma Makinesi':'broken'};
  const statusLabel=s=>s==='broken'?'Arızalı':s==='maintenance'?'Bakımda':'Aktif';
  document.getElementById('pageContent').innerHTML=`
    <div class="grid grid-4">${metric('🧺','Bugünkü randevu',db.laundry.filter(x=>x.date===date).length,'Tüm makineler')}${metric('✅','Beyaz Makine',statusLabel(db.settings.laundryMachineStatus['Beyaz Çamaşır Makinesi']),'Durum')}${metric('✅','Gri Makine',statusLabel(db.settings.laundryMachineStatus['Gri Çamaşır Makinesi']),'Durum')}${metric('🛠','Kurutma Makinesi',statusLabel(db.settings.laundryMachineStatus['Kurutma Makinesi']),'Arızalı cihazlara randevu alınamaz')}</div>
    ${isAdmin()?`<div class="card section-gap"><div class="card-header"><div><h3>Cihaz durum yönetimi</h3><p>Onarım/bakım sonrasında cihazı yeniden Aktif duruma alabilirsiniz.</p></div></div><div class="card-body machine-status-actions">${machines.map(m=>`<button class="btn btn-secondary" onclick="machineStatusModal('${m}')">${m}: ${statusLabel(db.settings.laundryMachineStatus[m])}</button>`).join('')}</div></div>`:''}
    <div class="card section-gap"><div class="card-header"><div><h3>Çamaşır randevusu</h3><p>Arızalı veya bakımda olan cihazlara randevu oluşturulamaz.</p></div><button class="btn btn-warning btn-sm" onclick="faultModal()">Arıza Kaydı Oluştur</button></div><div class="card-body"><div class="laundry-board">
      <div class="head">Saat</div>${machines.map(m=>`<div class="head">${m}<small>${statusLabel(db.settings.laundryMachineStatus[m])}</small></div>`).join('')}
      ${times.map(time=>`<div><strong>${time}</strong></div>${machines.map(machine=>{const booking=db.laundry.find(x=>x.date===date&&x.time===time&&x.machine===machine);const active=db.settings.laundryMachineStatus[machine]==='active';return booking?`<div class="slot busy"><strong>${escapeHtml(getUser(booking.userId)?.name||'-')}</strong>${hasPermission('laundry.manage')||booking.userId===currentUser.id?`<button class="btn btn-danger btn-sm" onclick="cancelLaundry(${booking.id})">İptal</button>`:'Rezerve'}</div>`:active?`<div class="slot free" onclick="bookLaundry('${date}','${time}','${machine}')">+ Randevu Al</div>`:`<div class="slot broken">🛠 ${statusLabel(db.settings.laundryMachineStatus[machine])}</div>`}).join('')}`).join('')}
    </div></div></div>
    <div class="card section-gap"><div class="card-header"><div><h3>Arıza kayıtları</h3><p>Personelin bildirdiği çamaşırhane arızaları</p></div></div><div class="table-wrap"><table><thead><tr><th>Cihaz</th><th>Bildiren</th><th>Tarih</th><th>Açıklama</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>${(db.laundryFaults||[]).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(f=>`<tr><td>${escapeHtml(f.machine)}</td><td>${escapeHtml(getUser(f.userId)?.name||'-')}</td><td>${new Date(f.createdAt).toLocaleString('tr-TR')}</td><td>${escapeHtml(f.note)}</td><td>${escapeHtml(f.status)}</td><td>${hasPermission('laundry.manage')||isAdmin()?`<button class="btn btn-secondary btn-sm" onclick="updateFaultStatus(${f.id})">Durumu Güncelle</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="6">Arıza kaydı bulunmuyor.</td></tr>'}</tbody></table></div></div>`;
}

function faultModal() {
  const machines=['Beyaz Çamaşır Makinesi','Gri Çamaşır Makinesi','Kurutma Makinesi'];
  showModal('Arıza Kaydı Oluştur',`<form id="faultForm" class="form-grid"><label class="span-2">Cihaz<select name="machine">${machines.map(x=>`<option>${x}</option>`).join('')}</select></label><label class="span-2">Arıza açıklaması<textarea name="note" required placeholder="Arızayı kısaca tarif edin"></textarea></label><div class="span-2"><button class="btn btn-warning btn-block">Arızayı Bildir</button></div></form>`);
  document.getElementById('faultForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target),machine=f.get('machine');db.laundryFaults||=[];db.laundryFaults.push({id:Date.now(),userId:currentUser.id,machine,note:f.get('note'),status:'Açık',createdAt:new Date().toISOString()});db.settings.laundryMachineStatus||={};db.settings.laundryMachineStatus[machine]='broken';logAudit('laundry.fault',`${machine}: ${f.get('note')}`);saveDB();closeModal();renderLaundry();toast('Arıza kaydı oluşturuldu.');});
}
function updateFaultStatus(id) {
  if(!hasPermission('laundry.manage')&&!isAdmin())return;
  const fault=(db.laundryFaults||[]).find(x=>x.id===Number(id));if(!fault)return;
  const next=prompt('Durum: Açık / İnceleniyor / Onarıldı',fault.status);if(!next)return;
  fault.status=next;fault.updatedAt=new Date().toISOString();
  if(next.toLocaleLowerCase('tr-TR').includes('onar')) db.settings.laundryMachineStatus[fault.machine]='active';
  else if(next.toLocaleLowerCase('tr-TR').includes('ince')) db.settings.laundryMachineStatus[fault.machine]='maintenance';
  else db.settings.laundryMachineStatus[fault.machine]='broken';
  saveDB();renderLaundry();toast('Arıza durumu güncellendi.');
}

function bookLaundry(date, time, machine) {
  const userId=currentUser.id;
  if((db.settings.laundryMachineStatus||{})[machine] !== 'active') return toast('Bu cihaz arızalı veya bakımda; randevu alınamaz.');
  if(db.laundry.some(x=>x.userId===userId&&x.date===date&&x.time===time)) return toast('Bu saatte başka bir randevunuz bulunuyor.');
  db.laundry.push({id:Date.now(),userId,date,time,machine});saveDB();renderLaundry();toast(`${machine} için ${time} randevusu oluşturuldu.`);
}
function cancelLaundry(id) { const booking = db.laundry.find(x => x.id === id); if (!booking || (!hasPermission('laundry.manage') && booking.userId !== currentUser.id)) return; db.laundry = db.laundry.filter(x => x.id !== id); saveDB(); renderLaundry(); toast('Randevu iptal edildi.'); }

function canViewReport(type) {
  if (isAdmin()) return true;
  if (type === 'meal') return hasPermission('meal.manage') || hasPermission('kitchen.view');
  if (type === 'finance' || type === 'balance') return hasPermission('finance.manage');
  if (type === 'leave') return hasPermission('leave.view');
  if (type === 'planning') return hasPermission('leave.plan');
  if (type === 'laundry') return hasPermission('laundry.manage');
  return false;
}
function renderReports() {
  if (!hasPermission('reports.view')) return goPage('dashboard');
  const cards = [
    ['meal','🍽','Yemek Katılım Raporu','Tarih ve öğün bazında katılım dökümü'],
    ['finance','₺','Borç ve Tahsilat Raporu','Dönemsel borç, ödeme ve bakiye özeti'],
    ['leave','📅','Yıllık İzin Raporu','Personel bazında kullanılan ve kalan izinler'],
    ['planning','⭐','İzin Planlama Raporu','Tercih, yönetim puanı ve dağıtım sonuçları'],
    ['laundry','🧺','Çamaşır Kullanım Raporu','Makine, randevu ve arıza kayıtları'],
    ['balance','📊','Aylık Bilanço','Malzeme, öğün maliyeti ve personel borçları']
  ].filter(x=>canViewReport(x[0]));
  document.getElementById('pageContent').innerHTML = cards.length
    ? `<div class="grid grid-3">${cards.map(x=>`<div class="card"><div class="card-body">${reportCard(...x)}</div></div>`).join('')}</div>`
    : '<div class="empty">Rolünüz için tanımlı rapor bulunmuyor.</div>';
}

function reportCard(type, icon, title, desc) {
  return `<div class="metric-icon">${icon}</div><h3>${title}</h3><p class="form-note">${desc}</p><div class="section-gap report-actions"><button class="btn btn-primary btn-sm" onclick="downloadCsv('${title}')">Excel/CSV İndir</button> <button class="btn btn-secondary btn-sm" onclick="openReportPreview('${type}')">PDF Önizle</button></div>`;
}
function reportPeriodKey() { return db.settings.balancePeriod || `${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}`; }
function reportHtml(type) {
  const generated = new Date().toLocaleString('tr-TR');
  const head = title => `<div class="report-head"><div><h1>PBYS</h1><p>Personel Bilgi Yönetim Sistemi</p></div><div><strong>${title}</strong><span>Oluşturma: ${generated}</span></div></div>`;
  if (type === 'meal') {
    const period = reportPeriodKey(), [y,m] = period.split('-').map(Number), last = new Date(y,m,0).getDate();
    const rows = Array.from({length:last},(_,i)=>`${y}-${pad(m)}-${pad(i+1)}`).map(date=>{const x=mealDateSummary(date);return `<tr><td>${formatDayDate(date)}</td><td>${x.breakfast}</td><td>${x.lunch}</td><td>${x.dinner}</td><td>${x.duty}</td><td>${x.no}</td><td>${x.leave}</td></tr>`}).join('');
    return `${head('Yemek Katılım Raporu')}<table><thead><tr><th>Tarih</th><th>Kahvaltı</th><th>Öğle</th><th>Akşam</th><th>Görev/Ayır</th><th>Yemeyecek</th><th>İzin</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (type === 'finance') {
    const rows = db.debts.map(d=>`<tr><td>${escapeHtml(getUser(d.userId)?.name||'-')}</td><td>${escapeHtml(d.period)}</td><td>${money(d.amount)}</td><td>${money(d.paid)}</td><td>${money(Math.max(0,d.amount-d.paid))}</td></tr>`).join('');
    return `${head('Borç ve Tahsilat Raporu')}<table><thead><tr><th>Personel</th><th>Dönem</th><th>Borç</th><th>Ödenen</th><th>Kalan</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Kayıt yok.</td></tr>'}</tbody></table>`;
  }
  if (type === 'leave') {
    const rows = approvedUsers().map(u=>`<tr><td>${escapeHtml(u.name)}</td><td>${u.annualAllowance??30}</td><td>${Number(u.usedLeave||0)+getApprovedAnnualDays(u.id,false)}</td><td>${getRemainingLeave(u)}</td><td>${u.roadAllowance??2}</td><td>${getRoadRemaining(u)}</td></tr>`).join('');
    return `${head('Yıllık İzin Raporu')}<table><thead><tr><th>Personel</th><th>Yıllık Hak</th><th>Kullanılan</th><th>Kalan</th><th>Yol Hak</th><th>Yol Kalan</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (type === 'planning') {
    const year=db.settings.leavePlanYear;
    const rows=planningUsers().map(u=>{const p=db.leavePreferences.find(x=>x.userId===u.id&&x.year===year);const r=db.leavePlanResults.find(x=>x.userId===u.id&&x.year===year);return `<tr><td>${escapeHtml(u.name)}</td><td>${u.planningScore??0}</td><td>${p?`${formatShortDate(p.firstStart)} - ${formatShortDate(p.firstEnd)}`:'—'}</td><td>${p?`${formatShortDate(p.secondStart)} - ${formatShortDate(p.secondEnd)}`:'—'}</td><td>${r?(r.choice?`${r.choice}. tercih`:'Tekrar tercih'):'—'}</td></tr>`}).join('');
    return `${head(`${year} İzin Planlama Raporu`)}<table><thead><tr><th>Personel</th><th>İç Puan</th><th>1. Tercih</th><th>2. Tercih</th><th>Karar</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (type === 'laundry') {
    const bookings=db.laundry.slice().sort((a,b)=>`${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)).map(x=>`<tr><td>${formatShortDate(x.date)}</td><td>${x.time}</td><td>${escapeHtml(x.machine)}</td><td>${escapeHtml(getUser(x.userId)?.name||'-')}</td><td>Randevu</td></tr>`);
    const faults=(db.laundryFaults||[]).map(x=>`<tr><td>${new Date(x.createdAt).toLocaleDateString('tr-TR')}</td><td>—</td><td>${escapeHtml(x.machine)}</td><td>${escapeHtml(getUser(x.userId)?.name||'-')}</td><td>Arıza: ${escapeHtml(x.status)}</td></tr>`);
    return `${head('Çamaşır Kullanım / Arıza Raporu')}<table><thead><tr><th>Tarih</th><th>Saat</th><th>Cihaz</th><th>Personel</th><th>İşlem</th></tr></thead><tbody>${[...bookings,...faults].join('')||'<tr><td colspan="5">Kayıt yok.</td></tr>'}</tbody></table>`;
  }
  const calc=balanceRowsForPeriod(reportPeriodKey());
  const expenseRows=db.expenses.filter(x=>x.date>=calc.start&&x.date<=calc.end).map(x=>`<tr><td>${formatShortDate(x.date)}</td><td>${escapeHtml(x.name)}</td><td>${money(x.amount)}</td></tr>`).join('');
  const personRows=calc.rows.map(x=>`<tr><td>${escapeHtml(x.user.name)}</td><td>${x.count}</td><td>${money(x.count*calc.unit)}</td></tr>`).join('');
  return `${head(`Aylık Tabldot Bilançosu · ${calc.label}`)}<div class="report-summary"><span>Toplam gider: <strong>${money(calc.totalExpense)}</strong></span><span>Toplam ücretli öğün: <strong>${calc.totalMeals}</strong></span><span>Öğün birim maliyeti: <strong>${money(calc.unit)}</strong></span></div><h3>Giderler</h3><table><thead><tr><th>Tarih</th><th>Malzeme</th><th>Tutar</th></tr></thead><tbody>${expenseRows||'<tr><td colspan="3">Gider yok.</td></tr>'}</tbody></table><h3>Personel Hesabı</h3><table><thead><tr><th>Personel</th><th>Öğün</th><th>Tutar</th></tr></thead><tbody>${personRows}</tbody></table>`;
}
function openReportPreview(type) {
  if (!hasPermission('reports.view') || !canViewReport(type)) return toast('Bu raporu görüntüleme yetkiniz yok.');
  const titleMap={meal:'Yemek Katılım Raporu',finance:'Borç ve Tahsilat Raporu',leave:'Yıllık İzin Raporu',planning:'İzin Planlama Raporu',laundry:'Çamaşır Kullanım Raporu',balance:'Aylık Bilanço'};
  showModal(`${titleMap[type] || 'Rapor'} · PDF Önizleme`, `<div class="pdf-preview" id="reportPreview">${reportHtml(type)}</div><div class="section-gap report-preview-actions"><button class="btn btn-primary" onclick="printReportPreview('${type}')">PDF / Yazdır</button></div>`);
}
function printReportPreview(type) {
  const existing=document.getElementById('reportPrintArea'); if(existing) existing.remove();
  const area=document.createElement('div'); area.id='reportPrintArea'; area.className='report-print-area'; area.innerHTML=reportHtml(type); document.body.appendChild(area);
  document.body.classList.add('printing-report');
  const cleanup=()=>{document.body.classList.remove('printing-report');area.remove();window.removeEventListener('afterprint',cleanup);};
  window.addEventListener('afterprint',cleanup);
  window.print();
  setTimeout(()=>{if(document.body.classList.contains('printing-report'))cleanup();},30000);
}
function downloadCsv(title) {
  let csv = 'Rapor;Tarih;Değer\n';
  if (title.includes('Borç')) csv += db.debts.map(d=>`${getUser(d.userId)?.name||'-'};${d.period};${d.amount-d.paid}`).join('\n');
  else if (title.includes('İzin')) csv += approvedUsers().map(u=>`${u.name};${toISO(new Date())};${getRemainingLeave(u)} gün kalan`).join('\n');
  else csv += `${title};${toISO(new Date())};PBYS raporu`;
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = title.replaceAll(' ', '_') + '.csv'; a.click(); URL.revokeObjectURL(a.href); toast('Rapor indirildi.');
}

function renderSettings() {
  if (!isAdmin()) return goPage('dashboard');
  document.getElementById('pageContent').innerHTML = `<div class="grid grid-2"><div class="card"><div class="card-header"><div><h3>PBYS sistem ayarları</h3><p>Ortak ayarlar Firestore settings/app belgesine yazılır.</p></div></div><div class="card-body"><form id="settingsForm">
    <label>Sistem adı<input name="systemName" value="${escapeHtml(db.settings.systemName || 'PBYS')}"></label>
    <label class="section-gap">Banka adı<input name="bankName" value="${escapeHtml(db.settings.bankName || '')}"></label>
    <label class="section-gap">Hesap sahibi<input name="accountName" value="${escapeHtml(db.settings.accountName)}"></label>
    <label class="section-gap">IBAN<input name="iban" value="${escapeHtml(db.settings.iban)}"></label>
    <label class="section-gap">Haftalık çamaşır kullanım limiti<input name="weeklyLaundryLimit" type="number" min="1" value="${db.settings.weeklyLaundryLimit}"></label>
    <label class="section-gap">Yıllık izin planlama yılı<input name="leavePlanYear" type="number" min="2026" value="${db.settings.leavePlanYear}"></label>
    <label class="section-gap">Aynı anda izinli azami oran (%)<input name="leaveConcurrentPercent" type="number" min="1" max="100" value="${db.settings.leaveConcurrentPercent || 25}"></label>
    <label class="section-gap">2. tercih kabul puan bonusu<input name="planningSecondChoiceBonus" type="number" min="0" value="${db.settings.planningSecondChoiceBonus ?? 20}"></label>
    <button class="btn btn-primary section-gap">Ayarları Kaydet</button></form></div></div>
    <div class="card"><div class="card-header"><div><h3>Firebase / Firestore</h3><p>Veriler site üzerinden yönetilir.</p></div></div><div class="card-body"><div class="firebase-card"><strong>Proje: ${escapeHtml(window.FirebaseBridge?.projectId || 'gencservi-5d47e')}</strong><span>Kullanıcı, yemek, izin, yoklama, ödeme, arıza ve çamaşır verileri Firestore koleksiyonlarında tutulur.</span><div class="sync-actions"><button class="btn btn-primary btn-sm" onclick="refreshFromCloud()">Buluttan Yenile</button><button class="btn btn-secondary btn-sm" onclick="exportBackup()">JSON Yedek İndir</button></div></div><p class="form-note section-gap">Test aşamasından sonra Firestore Security Rules rol/yetki sistemine göre kilitlenmelidir.</p></div></div></div>`;
  document.getElementById('settingsForm').addEventListener('submit', e => {
    e.preventDefault(); const f=new FormData(e.target);
    db.settings={...db.settings,systemName:f.get('systemName'),bankName:f.get('bankName'),accountName:f.get('accountName'),iban:f.get('iban'),weeklyLaundryLimit:Number(f.get('weeklyLaundryLimit')),leavePlanYear:Number(f.get('leavePlanYear')),leaveConcurrentPercent:Number(f.get('leaveConcurrentPercent')),planningSecondChoiceBonus:Number(f.get('planningSecondChoiceBonus'))};
    saveDB();toast('Sistem ayarları kaydedildi.');
  });
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
