/* Admin Console Controller Script */

let adminToken = localStorage.getItem("admin_token") || null;
let userDataList = [];
let installsChart = null;
let countriesChart = null;

let currentSortField = "installDate";
let currentSortOrder = "desc";

document.addEventListener("DOMContentLoaded", () => {
  if (adminToken) {
    showDashboard();
  } else {
    showLogin();
  }

  // Bind Login Trigger
  document.getElementById("login-btn").addEventListener("click", performLogin);
  document.getElementById("admin-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") performLogin();
  });

  // Bind Logout Trigger
  document.getElementById("logout-btn").addEventListener("click", performLogout);

  // Bind User Table Filters & Search
  document.getElementById("user-search").addEventListener("input", renderUsersTable);
  document.getElementById("filter-plan").addEventListener("change", loadUsersData);
  document.getElementById("filter-premium").addEventListener("change", loadUsersData);

  // Bind CSV Export
  document.getElementById("export-csv").addEventListener("click", exportUsersCSV);

  // Bind Settings Form Submit
  document.getElementById("settings-form").addEventListener("submit", updateSettingsConfig);

  // Bind Sorting click listeners to headers
  const headers = document.querySelectorAll(".data-table th.sortable");
  headers.forEach(h => {
    h.addEventListener("click", () => {
      const field = h.getAttribute("data-field");
      if (currentSortField === field) {
        currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
      } else {
        currentSortField = field;
        currentSortOrder = "desc";
      }
      renderUsersTable();
    });
  });
});

function showLogin() {
  document.getElementById("login-overlay").classList.remove("hidden");
  document.getElementById("app-wrapper").classList.add("hidden");
}

function showDashboard() {
  document.getElementById("login-overlay").classList.add("hidden");
  document.getElementById("app-wrapper").classList.remove("hidden");
  
  loadStatsData();
  loadUsersData();
}

async function performLogin() {
  const password = document.getElementById("admin-password").value;
  const loginError = document.getElementById("login-error");
  
  loginError.classList.add("hidden");

  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    if (res.ok) {
      const data = await res.json();
      adminToken = data.token;
      localStorage.setItem("admin_token", adminToken);
      showDashboard();
    } else {
      loginError.classList.remove("hidden");
    }
  } catch (error) {
    console.error("Login failure:", error);
    loginError.textContent = "Server connection lost.";
    loginError.classList.remove("hidden");
  }
}

function performLogout() {
  adminToken = null;
  localStorage.removeItem("admin_token");
  showLogin();
}

// Fetch stats and render visual analytics charts
async function loadStatsData() {
  try {
    const res = await fetch("/api/admin/stats", {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    if (res.status === 401 || res.status === 403) {
      performLogout();
      return;
    }

    if (res.ok) {
      const data = await res.json();
      renderStats(data.stats);
      renderCharts(data.installTimeline, data.topCountries);
      prefillSettingsForm(data.systemSettings);
    }
  } catch (err) {
    console.error("Failed to load statistics:", err);
  }
}

function renderStats(stats) {
  document.getElementById("stat-total-users").textContent = stats.totalUsers || 0;
  document.getElementById("stat-premium-users").textContent = stats.premiumUsers || 0;
  document.getElementById("stat-conversion-rate").textContent = `${stats.premiumConversionRate || 0}% Conversion Rate`;
  document.getElementById("stat-active-trials").textContent = stats.activeTrialUsers || 0;
  document.getElementById("stat-expired-trials").textContent = stats.expiredTrialUsers || 0;

  document.getElementById("stat-today-users").textContent = stats.todayUsers || 0;
  document.getElementById("stat-7days-users").textContent = stats.last7DaysUsers || 0;
  document.getElementById("stat-30days-users").textContent = stats.last30DaysUsers || 0;

  document.getElementById("stat-split-monthly").textContent = stats.monthlyUsers || 0;
  document.getElementById("stat-split-yearly").textContent = stats.yearlyUsers || 0;
  document.getElementById("stat-split-lifetime").textContent = stats.lifetimeUsers || 0;
}

// Draw line and bar charts using Chart.js
function renderCharts(timeline, topCountries) {
  // 1. Installs Timeline
  const timelineDates = Object.keys(timeline).sort();
  const timelineCounts = timelineDates.map(date => timeline[date]);

  const ctxInstalls = document.getElementById("installsChart").getContext("2d");
  if (installsChart) installsChart.destroy();
  
  installsChart = new Chart(ctxInstalls, {
    type: "line",
    data: {
      labels: timelineDates.slice(-14), // Last 14 days
      datasets: [{
        label: "Daily Installs",
        data: timelineCounts.slice(-14),
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56, 189, 248, 0.1)",
        borderWidth: 2.5,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#94a3b8" } },
        x: { grid: { display: false }, ticks: { color: "#94a3b8" } }
      },
      plugins: { legend: { display: false } }
    }
  });

  // 2. Geography Chart
  const countryNames = topCountries.map(c => c.name);
  const countryCounts = topCountries.map(c => c.count);

  const ctxCountries = document.getElementById("countriesChart").getContext("2d");
  if (countriesChart) countriesChart.destroy();

  countriesChart = new Chart(ctxCountries, {
    type: "bar",
    data: {
      labels: countryNames,
      datasets: [{
        label: "User Base",
        data: countryCounts,
        backgroundColor: ["#00f2fe", "#4facfe", "#38bdf8", "#10b981", "#f59e0b", "#a855f7", "#ec4899"],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#94a3b8" } },
        x: { grid: { display: false }, ticks: { color: "#94a3b8" } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// Pre-fill settings form configuration fields
function prefillSettingsForm(config) {
  document.getElementById("set-monthly-price").value = config.monthlyPrice || 4.99;
  document.getElementById("set-yearly-price").value = config.yearlyPrice || 29.99;
  document.getElementById("set-lifetime-price").value = config.lifetimePrice || 79.99;
  document.getElementById("set-trial-days").value = config.trialDays || 10;
  document.getElementById("set-extension-version").value = config.extensionVersion || "1.0.0";
  document.getElementById("set-announcements").value = config.announcements || "";
  document.getElementById("set-premium-features").checked = config.enablePremiumFeatures !== false;
  document.getElementById("set-maintenance-mode").checked = !!config.maintenanceMode;
}

// Fetch users detail list
async function loadUsersData() {
  const plan = document.getElementById("filter-plan").value;
  const premium = document.getElementById("filter-premium").value;

  try {
    const res = await fetch(`/api/admin/users?plan=${plan}&premium=${premium}`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      userDataList = data.users || [];
      renderUsersTable();
    }
  } catch (err) {
    console.error("Failed to load user list:", err);
  }
}

// Render dynamic user database rows (search, sort, filter client-side)
function renderUsersTable() {
  const tbody = document.getElementById("users-tbody");
  const searchQuery = document.getElementById("user-search").value.toLowerCase();

  let filtered = [...userDataList];

  // Apply Search query
  if (searchQuery) {
    filtered = filtered.filter(u => 
      u.uid.toLowerCase().includes(searchQuery) ||
      u.clientUid.toLowerCase().includes(searchQuery) ||
      u.country.toLowerCase().includes(searchQuery)
    );
  }

  // Apply client sorting
  filtered.sort((a, b) => {
    let valA = a[currentSortField];
    let valB = b[currentSortField];

    if (typeof valA === "string") {
      return valA.localeCompare(valB) * (currentSortOrder === "asc" ? 1 : -1);
    }
    if (valA === undefined || valA === null) return 1;
    if (valB === undefined || valB === null) return -1;

    return (valA < valB ? -1 : valA > valB ? 1 : 0) * (currentSortOrder === "asc" ? 1 : -1);
  });

  tbody.innerHTML = "";

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No client profiles match your filtering constraints.</td></tr>`;
    return;
  }

  filtered.forEach(u => {
    const installDate = u.installDate ? new Date(u.installDate).toLocaleDateString() : "---";
    const lastSeen = u.lastSeen ? new Date(u.lastSeen).toLocaleDateString() : "---";
    
    // Status Badge
    let statusText = "Trial Active";
    let statusClass = "trial";
    
    if (u.premiumStatus) {
      statusText = u.plan;
      statusClass = "premium";
    } else if (u.remainingDays === 0) {
      statusText = "Trial Expired";
      statusClass = "expired";
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="font-weight: 500; font-family: monospace; font-size: 13px;">${u.uid}</div>
        <div style="font-size: 11px; color: var(--text-muted);">SyncID: ${u.clientUid.substring(0, 15)}...</div>
      </td>
      <td>${installDate}</td>
      <td>${u.premiumStatus ? '∞' : u.remainingDays + ' Days'}</td>
      <td>${u.country}</td>
      <td>
        <div style="font-size: 12px;">Browser: v${u.browserVersion.split(".")[0]}</div>
        <div style="font-size: 11px; color: var(--text-muted);">Ext: v${u.extensionVersion}</div>
      </td>
      <td style="text-transform: capitalize;">${u.plan}</td>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td>${lastSeen}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Update Global config settings parameters
async function updateSettingsConfig(e) {
  e.preventDefault();

  const body = {
    monthlyPrice: document.getElementById("set-monthly-price").value,
    yearlyPrice: document.getElementById("set-yearly-price").value,
    lifetimePrice: document.getElementById("set-lifetime-price").value,
    trialDays: document.getElementById("set-trial-days").value,
    extensionVersion: document.getElementById("set-extension-version").value,
    announcements: document.getElementById("set-announcements").value,
    enablePremiumFeatures: document.getElementById("set-premium-features").checked,
    maintenanceMode: document.getElementById("set-maintenance-mode").checked
  };

  try {
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      showToast();
      loadStatsData(); // Refresh UI values
    } else {
      alert("Failed to save configuration settings.");
    }
  } catch (error) {
    console.error("Failed to update settings config:", error);
  }
}

// Client side CSV Generator & Exporter
function exportUsersCSV() {
  if (userDataList.length === 0) {
    alert("No data available to export.");
    return;
  }

  const headers = ["User UID", "Sync UID", "Fingerprint", "Install Date", "Remaining Trial", "Country", "Browser", "Ext Version", "Plan", "Premium Active", "Last Seen"];
  const rows = userDataList.map(u => [
    u.uid,
    u.clientUid,
    u.fingerprint,
    u.installDate || "",
    u.remainingDays,
    u.country,
    u.browserVersion,
    u.extensionVersion,
    u.plan,
    u.premiumStatus,
    u.lastSeen || ""
  ]);

  let csvContent = "data:text/csv;charset=utf-8," 
    + [headers.join(","), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `auto_refresh_users_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function showToast() {
  const toast = document.getElementById("toast");
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}
