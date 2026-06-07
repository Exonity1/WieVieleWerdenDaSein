/* ==========================================================================
   APPLICATION LOGIC - DAILY ATTENDANCE BETTING GAME
   Vanilla ES6 Javascript - Supabase Integration & Single Page Router
   ========================================================================== */

// 1. SUPABASE CONFIGURATION
// If these placeholders are left untouched, the app will prompt for them via a premium UI modal
// and save them to localStorage. This makes it instantly deployable on Vercel without files editing!
const DEFAULT_SUPABASE_URL = ""; 
const DEFAULT_SUPABASE_ANON_KEY = "";

let supabaseUrl = DEFAULT_SUPABASE_URL;
let supabaseKey = DEFAULT_SUPABASE_ANON_KEY;

// Check localStorage as fallback
if (!supabaseUrl || supabaseUrl.includes("your-project-id")) {
  supabaseUrl = localStorage.getItem("supabase_url") || "";
}
if (!supabaseKey || supabaseKey.includes("your-anon-key")) {
  supabaseKey = localStorage.getItem("supabase_anon_key") || "";
}

// 14-Day Hardcoded Schedule (German/Berlin timezone context)
const CLASS_SCHEDULE = {
  '2026-06-08': '08:15',
  '2026-06-09': '10:00',
  '2026-06-10': '08:15',
  '2026-06-11': '14:00',
  '2026-06-12': '08:15',
  '2026-06-15': '08:15',
  '2026-06-16': '10:00',
  '2026-06-17': '08:15',
  '2026-06-18': '14:00',
  '2026-06-19': '08:15',
  '2026-06-22': '08:15',
  '2026-06-23': '10:00',
  '2026-06-24': '08:15',
  '2026-06-25': '14:00'
};

// Application State
let supabase = null;
let currentUser = null;
let currentProfile = null;
let currentActiveBettingClass = null; // { date, time, timestamp }
let countdownInterval = null;
let userBets = [];
let dbSchedule = [];

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconClass = 'fa-info-circle';
  if (type === 'success') iconClass = 'fa-circle-check';
  if (type === 'error') iconClass = 'fa-circle-exclamation';
  
  toast.innerHTML = `
    <i class="fa-solid ${iconClass}"></i>
    <div class="toast-content">${message}</div>
    <button class="toast-close" aria-label="Close Notification"><i class="fa-solid fa-xmark"></i></button>
  `;
  
  // Close handler
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => removeToast(toast));
  
  // Auto remove
  const timeoutId = setTimeout(() => removeToast(toast), 5000);
  toast.dataset.timeoutId = timeoutId;
  
  container.appendChild(toast);
}

function removeToast(toast) {
  if (toast.classList.contains('removing')) return;
  toast.classList.add('removing');
  clearTimeout(toast.dataset.timeoutId);
  toast.addEventListener('animationend', () => {
    toast.remove();
  });
}

// ==========================================
// SUPABASE CLIENT INITIALIZATION & SETUP MODAL
// ==========================================
function initSupabase() {
  if (!supabaseUrl || !supabaseKey) {
    createSetupModal();
    return false;
  }
  
  try {
    // Initialize Supabase from the global CDN namespace
    supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    return true;
  } catch (error) {
    console.error("Supabase initialization error:", error);
    showToast("Invalid Supabase connection credentials.", "error");
    createSetupModal();
    return false;
  }
}

function createSetupModal() {
  // Check if modal already exists
  if (document.getElementById('setup-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'setup-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.background = 'rgba(10, 13, 26, 0.95)';
  modal.style.backdropFilter = 'blur(16px)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';
  modal.style.padding = '20px';

  modal.innerHTML = `
    <div class="glass-card" style="width: 100%; max-width: 500px; text-align: center;">
      <h2 style="font-family: var(--font-title); font-size: 1.75rem; margin-bottom: 12px;" class="text-gradient-primary">Connect your Supabase</h2>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 24px;">
        To activate the app, please paste your Supabase Project credentials. These can be found under your Supabase Project settings > API.
      </p>
      <form id="setup-form" style="display: flex; flex-direction: column; gap: 16px; text-align: left;">
        <div class="form-group">
          <label style="font-weight:600;">Supabase Project URL</label>
          <input type="url" id="setup-url" class="input-field" style="padding-left:14px;" placeholder="https://your-project-id.supabase.co" required>
        </div>
        <div class="form-group">
          <label style="font-weight:600;">Supabase Anon API Key</label>
          <input type="text" id="setup-key" class="input-field" style="padding-left:14px;" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." required>
        </div>
        <button type="submit" class="btn-primary" style="margin-top: 10px;">
          Connect Application & Refresh
        </button>
      </form>
      <div style="margin-top: 15px; font-size: 0.75rem; color: var(--text-muted);">
        Credentials will be safely saved in your local browser cache (localStorage).
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('setup-url').value.trim();
    const key = document.getElementById('setup-key').value.trim();
    
    localStorage.setItem('supabase_url', url);
    localStorage.setItem('supabase_anon_key', key);
    
    showToast("Supabase credentials saved successfully!", "success");
    setTimeout(() => window.location.reload(), 1000);
  });
}

// ==========================================
// VIEW CONTROLLER / ROUTER
// ==========================================
function switchView(viewName) {
  // Hide all sections
  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.remove('active');
  });

  // Deactivate footer nav links
  document.querySelectorAll('.footer-link').forEach(link => {
    link.classList.remove('active');
  });

  // Activate selected section
  const activeSection = document.getElementById(`${viewName}-section`);
  if (activeSection) {
    activeSection.classList.add('active');
  }

  // Highlight active nav
  const activeNavLink = document.getElementById(`nav-${viewName}-link`);
  if (activeNavLink) {
    activeNavLink.classList.add('active');
  }

  // Load view-specific data
  if (viewName === 'dashboard') {
    loadDashboardData();
  } else if (viewName === 'leaderboard') {
    loadLeaderboardData();
  } else if (viewName === 'admin') {
    loadAdminData();
  }
}

// Set up UI Event Listeners
function setupViewNavigation() {
  document.getElementById('nav-dashboard-link').addEventListener('click', () => switchView('dashboard'));
  document.getElementById('nav-leaderboard-link').addEventListener('click', () => switchView('leaderboard'));
  
  // Admin Panel Button click
  document.getElementById('admin-panel-badge').addEventListener('click', () => switchView('admin'));

  // Auth toggle click
  const authToggleLink = document.getElementById('auth-toggle-link');
  authToggleLink.addEventListener('click', () => {
    const isLogin = document.getElementById('login-form').style.display !== 'none';
    if (isLogin) {
      // Switch to Register
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('register-form').style.display = 'block';
      document.getElementById('auth-title').innerText = "Create Account";
      document.getElementById('auth-description').innerText = "Join the pool and get 100 free tokens!";
      document.getElementById('auth-toggle-prompt').innerText = "Already have an account?";
      authToggleLink.innerText = "Sign In";
    } else {
      // Switch to Login
      document.getElementById('login-form').style.display = 'block';
      document.getElementById('register-form').style.display = 'none';
      document.getElementById('auth-title').innerText = "Welcome Back";
      document.getElementById('auth-description').innerText = "Sign in to place your daily attendance guess!";
      document.getElementById('auth-toggle-prompt').innerText = "Don't have an account?";
      authToggleLink.innerText = "Sign Up";
    }
  });
}

// ==========================================
// AUTHENTICATION LOGIC
// ==========================================
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email-input').value.trim();
  const password = document.getElementById('login-password-input').value;
  const submitBtn = document.getElementById('login-submit-btn');

  submitBtn.disabled = true;
  submitBtn.innerHTML = `Connecting... <i class="fa-solid fa-spinner fa-spin"></i>`;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    showToast(error.message, 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Sign In</span> <i class="fa-solid fa-right-to-bracket"></i>`;
  } else {
    showToast("Signed in successfully!", "success");
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('register-username-input').value.trim();
  const email = document.getElementById('register-email-input').value.trim();
  const password = document.getElementById('register-password-input').value;
  const submitBtn = document.getElementById('register-submit-btn');

  submitBtn.disabled = true;
  submitBtn.innerHTML = `Registering... <i class="fa-solid fa-spinner fa-spin"></i>`;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: username }
    }
  });

  if (error) {
    showToast(error.message, 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Create Account</span> <i class="fa-solid fa-user-plus"></i>`;
  } else {
    showToast("Registration successful! Logging in...", "success");
    // Under disabled confirmation email settings, Supabase logs the user in immediately
  }
}

async function handleLogout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    showToast(error.message, 'error');
  } else {
    showToast("Logged out successfully.", "info");
  }
}

// Sync Auth Session States
async function onSessionChanged(session) {
  if (session) {
    currentUser = session.user;
    
    // Fetch user profile from database
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();
      
    if (error) {
      console.error("Error loading profile:", error);
      showToast("Error loading profile details.", "error");
      return;
    }
    
    currentProfile = profile;
    
    // Update Header UI details
    document.getElementById('user-tokens-val').innerText = profile.tokens;
    document.getElementById('user-display-name').innerText = profile.username;
    document.getElementById('user-avatar').innerText = profile.username.charAt(0).toUpperCase();
    
    // Check Admin status
    if (profile.is_admin) {
      document.getElementById('admin-panel-badge').style.display = 'inline-flex';
    } else {
      document.getElementById('admin-panel-badge').style.display = 'none';
      if (document.getElementById('admin-section').classList.contains('active')) {
        switchView('dashboard');
      }
    }
    
    // Show application screens
    document.getElementById('main-header').style.display = 'flex';
    document.getElementById('main-footer').style.display = 'block';
    
    if (document.getElementById('auth-section').classList.contains('active')) {
      switchView('dashboard');
    }
  } else {
    // Reset session variables
    currentUser = null;
    currentProfile = null;
    userBets = [];
    dbSchedule = [];
    clearInterval(countdownInterval);
    
    // Display login screen
    document.getElementById('main-header').style.display = 'none';
    document.getElementById('main-footer').style.display = 'none';
    
    // Hide panels
    document.querySelectorAll('.view-section').forEach(section => {
      section.classList.remove('active');
    });
    document.getElementById('auth-section').classList.add('active');
    
    // Clear forms
    document.getElementById('login-form').reset();
    document.getElementById('register-form').reset();
    document.getElementById('login-submit-btn').disabled = false;
    document.getElementById('login-submit-btn').innerHTML = `<span>Sign In</span> <i class="fa-solid fa-right-to-bracket"></i>`;
    document.getElementById('register-submit-btn').disabled = false;
    document.getElementById('register-submit-btn').innerHTML = `<span>Create Account</span> <i class="fa-solid fa-user-plus"></i>`;
  }
}

// ==========================================
// TIME-LOCK & DEADLINE SCHEDULER
// ==========================================

// Determines the active betting class from class schedules
function getActiveBettingClass() {
  const now = Date.now();
  const sortedDates = Object.keys(CLASS_SCHEDULE).sort();
  
  for (const dateStr of sortedDates) {
    const timeStr = CLASS_SCHEDULE[dateStr];
    // Schedule starts in Europe/Berlin (UTC+2 in Summer, e.g. June)
    // Parse it as local timestamp with +02:00 zone to align with database seed
    const classTime = new Date(`${dateStr}T${timeStr}:00+02:00`);
    const deadlineTime = classTime.getTime() - (5 * 60 * 1000); // 5 minutes lock
    
    if (now < deadlineTime) {
      return {
        date: dateStr,
        time: timeStr,
        deadlineTimestamp: deadlineTime,
        classTimestamp: classTime.getTime()
      };
    }
  }
  
  // Fallback: If all scheduled dates are in the past, return the last date (locked state)
  const lastDate = sortedDates[sortedDates.length - 1];
  const lastTime = CLASS_SCHEDULE[lastDate];
  const classTime = new Date(`${lastDate}T${lastTime}:00+02:00`);
  return {
    date: lastDate,
    time: lastTime,
    deadlineTimestamp: classTime.getTime() - (5 * 60 * 1000),
    classTimestamp: classTime.getTime(),
    allPast: true
  };
}

function startCountdown() {
  clearInterval(countdownInterval);
  currentActiveBettingClass = getActiveBettingClass();
  
  const timerElement = document.getElementById('countdown-timer');
  const dateSubElement = document.getElementById('countdown-date-sub');
  
  if (!currentActiveBettingClass) {
    timerElement.innerText = "No Class Scheduled";
    timerElement.className = "countdown-timer expired";
    dateSubElement.innerText = "";
    document.getElementById('bet-submit-btn').disabled = true;
    return;
  }
  
  const dateParts = currentActiveBettingClass.date.split('-');
  const displayDateStr = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;
  
  timerElement.classList.remove('loading');
  
  if (currentActiveBettingClass.allPast) {
    timerElement.innerText = "Closed";
    timerElement.className = "countdown-timer expired";
    dateSubElement.innerText = `All betting pools locked (${displayDateStr} @ ${currentActiveBettingClass.time})`;
    document.getElementById('bet-submit-btn').disabled = true;
    return;
  }
  
  dateSubElement.innerText = `For class on: ${displayDateStr} at ${currentActiveBettingClass.time}`;
  
  function updateTimer() {
    const timeLeft = currentActiveBettingClass.deadlineTimestamp - Date.now();
    
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      timerElement.innerText = "Closed";
      timerElement.className = "countdown-timer expired";
      document.getElementById('bet-submit-btn').disabled = true;
      // Hot reload active state
      loadDashboardData();
      return;
    }
    
    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
    
    const hStr = hours.toString().padStart(2, '0');
    const mStr = minutes.toString().padStart(2, '0');
    const sStr = seconds.toString().padStart(2, '0');
    
    timerElement.innerText = `${hStr}h ${mStr}m ${sStr}s`;
  }
  
  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

// ==========================================
// DATA RETRIEVAL (DASHBOARD)
// ==========================================
async function loadDashboardData() {
  if (!currentUser) return;
  
  // 1. Start countdown timer calculations
  startCountdown();
  
  // 2. Fetch User Profile to keep tokens updated
  const { data: updatedProfile } = await supabase
    .from('profiles')
    .select('tokens')
    .eq('id', currentUser.id)
    .single();
  if (updatedProfile) {
    currentProfile.tokens = updatedProfile.tokens;
    document.getElementById('user-tokens-val').innerText = updatedProfile.tokens;
  }

  // 3. Fetch all bets placed by this user
  const { data: bets, error: betsErr } = await supabase
    .from('bets')
    .select('*')
    .eq('user_id', currentUser.id);
    
  if (betsErr) {
    console.error("Error loading user bets:", betsErr);
    showToast("Error retrieving betting history.", "error");
    return;
  }
  userBets = bets || [];

  // 4. Fetch the database class schedule (limit 14)
  const { data: schedule, error: schedErr } = await supabase
    .from('schedule')
    .select('*')
    .order('class_date', { ascending: true })
    .limit(14);
    
  if (schedErr) {
    console.error("Error loading schedule:", schedErr);
    showToast("Error retrieving class schedule.", "error");
    return;
  }
  dbSchedule = schedule || [];

  // Render elements
  renderActiveBettingState();
  renderScheduleTimeline();
}

function renderActiveBettingState() {
  if (!currentActiveBettingClass || currentActiveBettingClass.allPast) {
    document.getElementById('bet-input-form').style.display = 'none';
    document.getElementById('placed-bet-info').style.display = 'none';
    return;
  }

  // Search if the user has already bet on this active class date
  const todaysBet = userBets.find(b => b.bet_date === currentActiveBettingClass.date);

  if (todaysBet) {
    // Already placed bet: Display placed bet info card
    document.getElementById('bet-input-form').style.display = 'none';
    document.getElementById('placed-bet-info').style.display = 'flex';
    document.getElementById('placed-bet-val').innerText = todaysBet.guess;
  } else {
    // No bet placed yet: Display bet input form
    document.getElementById('bet-input-form').style.display = 'flex';
    document.getElementById('placed-bet-info').style.display = 'none';
    document.getElementById('bet-guess-input').value = '';
    
    // Disable form submission if deadline has passed
    const isDeadlinePassed = Date.now() >= currentActiveBettingClass.deadlineTimestamp;
    document.getElementById('bet-submit-btn').disabled = isDeadlinePassed;
  }
}

function renderScheduleTimeline() {
  const container = document.getElementById('schedule-list');
  if (!container) return;
  
  if (dbSchedule.length === 0) {
    container.innerHTML = `<div class="schedule-item" style="justify-content:center; color:var(--text-muted);">No schedule seeded in the database.</div>`;
    return;
  }
  
  container.innerHTML = '';
  
  dbSchedule.forEach(item => {
    // Match matching user bet
    const bet = userBets.find(b => b.bet_date === item.class_date);
    
    const classDateParts = item.class_date.split('-');
    const formattedDate = `${classDateParts[2]}.${classDateParts[1]}.${classDateParts[0]}`;
    
    // Parse time
    const rawTime = new Date(item.class_time);
    const formattedTime = rawTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Calculate status badge details
    let badgeHtml = '';
    let guessDetailHtml = '';
    let payoutHtml = '';
    
    if (item.is_resolved) {
      if (bet) {
        if (bet.status === 'won') {
          badgeHtml = `<span class="badge badge-won"><i class="fa-solid fa-circle-check"></i> Won</span>`;
          payoutHtml = `<span class="schedule-actual-payout">+${bet.payout} Tokens</span>`;
        } else {
          badgeHtml = `<span class="badge badge-lost"><i class="fa-solid fa-circle-xmark"></i> Lost</span>`;
          payoutHtml = `<span class="schedule-actual-payout" style="color:var(--color-error);">0 Tokens</span>`;
        }
        guessDetailHtml = `<div class="schedule-guess-badge">Guessed: <span>${bet.guess}</span> (Actual: ${item.actual_attendance})</div>`;
      } else {
        badgeHtml = `<span class="badge badge-locked"><i class="fa-solid fa-ban"></i> No Bet</span>`;
        guessDetailHtml = `<div class="schedule-guess-badge">Actual Attendance: <span>${item.actual_attendance}</span></div>`;
      }
    } else {
      // Unresolved: Check if betting time limit is active
      const deadline = new Date(item.class_time).getTime() - (5 * 60 * 1000);
      const isLocked = Date.now() >= deadline;
      
      if (isLocked) {
        badgeHtml = `<span class="badge badge-locked"><i class="fa-solid fa-lock"></i> Locked</span>`;
        if (bet) {
          guessDetailHtml = `<div class="schedule-guess-badge">Guessed: <span>${bet.guess}</span> (Awaiting outcome)</div>`;
        } else {
          guessDetailHtml = `<div class="schedule-guess-badge" style="color:var(--color-error);">Missed deadline</div>`;
        }
      } else {
        badgeHtml = `<span class="badge badge-pending"><i class="fa-solid fa-clock"></i> Open</span>`;
        if (bet) {
          guessDetailHtml = `<div class="schedule-guess-badge">Guessed: <span>${bet.guess}</span></div>`;
        } else {
          guessDetailHtml = `<div class="schedule-guess-badge" style="color:var(--text-muted);">No bet placed yet</div>`;
        }
      }
    }
    
    const itemEl = document.createElement('div');
    itemEl.className = 'schedule-item';
    itemEl.innerHTML = `
      <div class="schedule-date-info">
        <span class="schedule-date">${formattedDate}</span>
        <span class="schedule-time"><i class="fa-regular fa-clock"></i> ${formattedTime}</span>
      </div>
      <div class="schedule-outcome-info">
        ${badgeHtml}
        ${guessDetailHtml}
        ${payoutHtml}
      </div>
    `;
    container.appendChild(itemEl);
  });
}

// ==========================================
// DATA RETRIEVAL (LEADERBOARD)
// ==========================================
async function loadLeaderboardData() {
  const podiumContainer = document.getElementById('podium-container');
  const listContainer = document.getElementById('leaderboard-rows-container');
  
  if (!podiumContainer || !listContainer) return;
  
  // Fetch top 50 users from profiles sorted by token balance
  const { data: leaderboard, error } = await supabase
    .from('profiles')
    .select('username, tokens')
    .order('tokens', { ascending: false })
    .limit(50);
    
  if (error) {
    console.error("Error fetching leaderboard:", error);
    showToast("Error loading global rankings.", "error");
    return;
  }
  
  const rankList = leaderboard || [];
  
  // Render Podium (Top 3)
  const podiumHTML = {
    first: { username: 'Empty', tokens: '0' },
    second: { username: 'Empty', tokens: '0' },
    third: { username: 'Empty', tokens: '0' }
  };
  
  if (rankList.length > 0) podiumHTML.first = rankList[0];
  if (rankList.length > 1) podiumHTML.second = rankList[1];
  if (rankList.length > 2) podiumHTML.third = rankList[2];
  
  podiumContainer.innerHTML = `
    <!-- 2nd Place -->
    <div class="podium-card podium-2nd">
      <div class="podium-avatar">${podiumHTML.second.username.charAt(0).toUpperCase()}</div>
      <div class="podium-rank">2nd Place</div>
      <div class="podium-username" title="${podiumHTML.second.username}">${podiumHTML.second.username}</div>
      <div class="podium-tokens"><i class="fa-solid fa-coins"></i> ${podiumHTML.second.tokens}</div>
    </div>
    
    <!-- 1st Place -->
    <div class="podium-card podium-1st">
      <i class="fa-solid fa-crown podium-crown"></i>
      <div class="podium-avatar" style="width: 76px; height: 76px; font-size: 1.8rem; margin-top: -10px;">
        ${podiumHTML.first.username.charAt(0).toUpperCase()}
      </div>
      <div class="podium-rank">1st Place</div>
      <div class="podium-username" title="${podiumHTML.first.username}" style="font-size: 1.25rem;">${podiumHTML.first.username}</div>
      <div class="podium-tokens" style="font-size:1.1rem;"><i class="fa-solid fa-coins" style="color:#fbbf24;"></i> ${podiumHTML.first.tokens}</div>
    </div>
    
    <!-- 3rd Place -->
    <div class="podium-card podium-3rd">
      <div class="podium-avatar">${podiumHTML.third.username.charAt(0).toUpperCase()}</div>
      <div class="podium-rank">3rd Place</div>
      <div class="podium-username" title="${podiumHTML.third.username}">${podiumHTML.third.username}</div>
      <div class="podium-tokens"><i class="fa-solid fa-coins"></i> ${podiumHTML.third.tokens}</div>
    </div>
  `;
  
  // Render Rank List (Rank 4+)
  listContainer.innerHTML = '';
  
  if (rankList.length <= 3) {
    listContainer.innerHTML = `<div class="leaderboard-row" style="justify-content:center; color:var(--text-muted);">No additional rank listings.</div>`;
    return;
  }
  
  for (let i = 3; i < rankList.length; i++) {
    const userRow = rankList[i];
    const rowEl = document.createElement('div');
    rowEl.className = 'leaderboard-row';
    rowEl.innerHTML = `
      <div class="leaderboard-rank-num">#${i + 1}</div>
      <div class="leaderboard-user-details">
        <div class="leaderboard-row-avatar">${userRow.username.charAt(0).toUpperCase()}</div>
        <div class="leaderboard-row-username" title="${userRow.username}">${userRow.username}</div>
      </div>
      <div class="leaderboard-row-tokens">
        <i class="fa-solid fa-coins" style="font-size: 0.85rem; color:#fbbf24;"></i> ${userRow.tokens}
      </div>
    `;
    listContainer.appendChild(rowEl);
  }
}

// ==========================================
// DATA RETRIEVAL (ADMIN PANEL)
// ==========================================
async function loadAdminData() {
  if (!currentProfile || !currentProfile.is_admin) {
    switchView('dashboard');
    return;
  }

  const select = document.getElementById('admin-resolve-date-select');
  if (!select) return;

  // Clear older entries
  select.innerHTML = '<option value="" disabled selected>Select class date...</option>';

  // Load unresolved classes from the database schedule list
  const { data: schedule, error } = await supabase
    .from('schedule')
    .select('class_date, is_resolved')
    .order('class_date', { ascending: false });
    
  if (error) {
    console.error("Error fetching admin schedule:", error);
    showToast("Error loading schedule list.", "error");
    return;
  }
  
  const openScheduleList = schedule || [];
  let openCount = 0;
  
  openScheduleList.forEach(item => {
    if (!item.is_resolved) {
      const dateParts = item.class_date.split('-');
      const formatted = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;
      
      const option = document.createElement('option');
      option.value = item.class_date;
      option.innerText = `${formatted} (Unresolved)`;
      select.appendChild(option);
      openCount++;
    }
  });
  
  if (openCount === 0) {
    const option = document.createElement('option');
    option.disabled = true;
    option.innerText = "No unresolved class schedules found.";
    select.appendChild(option);
  }
}

// ==========================================
// SUBMISSIONS & DB OPERATIONS
// ==========================================
async function placeBetHandler(e) {
  e.preventDefault();
  
  if (!currentActiveBettingClass) {
    showToast("No active betting session currently open.", "error");
    return;
  }

  const guessInput = document.getElementById('bet-guess-input');
  const guessVal = parseInt(guessInput.value);
  const submitBtn = document.getElementById('bet-submit-btn');

  if (isNaN(guessVal) || guessVal < 0) {
    showToast("Please enter a valid attendance guess (0 or more).", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `Securing... <i class="fa-solid fa-spinner fa-spin"></i>`;

  // Place bet via RPC on Supabase (deducts tokens, locks time check, saves bet server side)
  const { data: newBalance, error } = await supabase.rpc('place_bet', {
    target_date: currentActiveBettingClass.date,
    guessed_amount: guessVal
  });

  if (error) {
    showToast(error.message, 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Lock In Bet</span> <i class="fa-solid fa-lock-open"></i>`;
  } else {
    showToast("Bet successfully registered! 10 Tokens locked.", "success");
    // Reload token balance & dashboard UI state
    currentProfile.tokens = newBalance;
    document.getElementById('user-tokens-val').innerText = newBalance;
    loadDashboardData();
  }
}

async function resolveBetsHandler(e) {
  e.preventDefault();

  const select = document.getElementById('admin-resolve-date-select');
  const selectedDate = select.value;
  const actualCountInput = document.getElementById('admin-actual-count-input');
  const actualCount = parseInt(actualCountInput.value);
  const submitBtn = document.getElementById('admin-resolve-submit-btn');

  if (!selectedDate) {
    showToast("Please select a date to resolve.", "error");
    return;
  }

  if (isNaN(actualCount) || actualCount < 0) {
    showToast("Please enter a valid attendance number.", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `Resolving & Awarding... <i class="fa-solid fa-spinner fa-spin"></i>`;

  // Resolve bets via Stored Procedure RPC on Supabase
  const { data: resolvedBetsCount, error } = await supabase.rpc('resolve_bets', {
    actual_number: actualCount,
    target_date: selectedDate
  });

  if (error) {
    showToast(error.message, 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Calculate Payouts & Resolve Bets</span> <i class="fa-solid fa-calculator"></i>`;
  } else {
    showToast(`Successfully resolved ${resolvedBetsCount} bets! Payouts applied.`, "success");
    
    // Clear admin form inputs
    actualCountInput.value = '';
    
    // Reload admin selector and refresh token balance
    loadAdminData();
    
    // Fetch profile again in case admin themselves placed a bet and won/lost
    const { data: updatedProfile } = await supabase
      .from('profiles')
      .select('tokens')
      .eq('id', currentUser.id)
      .single();
    if (updatedProfile) {
      currentProfile.tokens = updatedProfile.tokens;
      document.getElementById('user-tokens-val').innerText = updatedProfile.tokens;
    }
  }
}

// ==========================================
// INITIAL APPLICATION MOUNT
// ==========================================
function mountApp() {
  // 1. Initialize view switches & nav handlers
  setupViewNavigation();
  
  // 2. Initialize Supabase Connection
  if (!initSupabase()) return;
  
  // 3. Bind form submission handlers
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('bet-input-form').addEventListener('submit', placeBetHandler);
  document.getElementById('admin-resolve-form').addEventListener('submit', resolveBetsHandler);
  
  // 4. Subscribe to Supabase Auth State Events
  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log("Auth event fired:", event);
    await onSessionChanged(session);
  });
}

// Kickstart script execution when browser loads DOM
window.addEventListener('DOMContentLoaded', mountApp);
