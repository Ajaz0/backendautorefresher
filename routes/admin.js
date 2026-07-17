const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { db, getTimestampDate } = require("../config/firebase");
const { verifyAdminToken } = require("../middleware/auth");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_default_secret_key_for_local_testing_purposes";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Admin Authentication Login
router.post("/login", (req, res) => {
  const { password } = req.body;

  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "24h" });
    return res.status(200).json({ token });
  } else {
    return res.status(401).json({ error: "Invalid admin password." });
  }
});

// GET: Admin Aggregated Statistics & Metrics
router.get("/stats", verifyAdminToken, async (req, res) => {
  try {
    const usersSnap = await db.collection("users").get();
    const settingsSnap = await db.collection("settings").doc("global").get();
    
    let totalUsers = 0;
    let activeTrialUsers = 0;
    let expiredTrialUsers = 0;
    let premiumUsers = 0;
    let monthlyUsers = 0;
    let yearlyUsers = 0;
    let lifetimeUsers = 0;
    let todayUsers = 0;
    let last7DaysUsers = 0;
    let last30DaysUsers = 0;

    const countryCounts = {};
    const installDatesTimeline = {}; // { YYYY-MM-DD: count }
    const now = new Date();
    
    // Parse time bounds
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    usersSnap.forEach(doc => {
      totalUsers++;
      const user = doc.data();
      const installDate = getTimestampDate(user.installDate);
      const trialEnd = getTimestampDate(user.trialEnd);
      
      // Calculate premium / trial splits
      if (user.premiumStatus === true) {
        premiumUsers++;
        if (user.plan === "monthly") monthlyUsers++;
        else if (user.plan === "yearly") yearlyUsers++;
        else if (user.plan === "lifetime") lifetimeUsers++;
      } else {
        if (trialEnd && trialEnd >= now) {
          activeTrialUsers++;
        } else {
          expiredTrialUsers++;
        }
      }

      // Time aggregates
      if (installDate) {
        if (installDate >= startOfToday) todayUsers++;
        if (installDate >= sevenDaysAgo) last7DaysUsers++;
        if (installDate >= thirtyDaysAgo) last30DaysUsers++;

        // Install timeline key YYYY-MM-DD
        const dateStr = installDate.toISOString().split("T")[0];
        installDatesTimeline[dateStr] = (installDatesTimeline[dateStr] || 0) + 1;
      }

      // Country aggregates
      const country = user.country || "Unknown";
      countryCounts[country] = (countryCounts[country] || 0) + 1;
    });

    // Conversion rate calculation
    const premiumConversionRate = totalUsers > 0 
      ? Number(((premiumUsers / totalUsers) * 100).toFixed(2)) 
      : 0;

    // Top Countries sorted list
    const topCountries = Object.keys(countryCounts)
      .map(name => ({ name, count: countryCounts[name] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Global configurations
    const systemSettings = settingsSnap.exists 
      ? settingsSnap.data() 
      : {};

    return res.status(200).json({
      stats: {
        totalUsers,
        activeTrialUsers,
        expiredTrialUsers,
        premiumUsers,
        monthlyUsers,
        yearlyUsers,
        lifetimeUsers,
        todayUsers,
        last7DaysUsers,
        last30DaysUsers,
        premiumConversionRate
      },
      topCountries,
      installTimeline: installDatesTimeline,
      systemSettings
    });

  } catch (error) {
    console.error("Admin stats aggregation error:", error);
    return res.status(500).json({ error: "Failed to gather statistics." });
  }
});

// GET: User Management Table details (supports search, filters, sorts)
router.get("/users", verifyAdminToken, async (req, res) => {
  try {
    const { search, plan, premium, sortField, sortOrder } = req.query;

    const usersSnap = await db.collection("users").get();
    let users = [];

    const now = new Date();

    usersSnap.forEach(doc => {
      const u = doc.data();
      const installDate = getTimestampDate(u.installDate);
      const trialEnd = getTimestampDate(u.trialEnd);
      const lastSeen = getTimestampDate(u.lastSeen);

      const diffTime = trialEnd.getTime() - now.getTime();
      const remainingDays = now > trialEnd ? 0 : Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      users.push({
        uid: u.uid,
        clientUid: u.clientUid,
        fingerprint: u.fingerprint,
        installDate: installDate ? installDate.toISOString() : null,
        trialStart: u.trialStart,
        trialEnd: u.trialEnd,
        remainingDays,
        country: u.country || "Unknown",
        browserVersion: u.browserVersion || "Unknown",
        extensionVersion: u.extensionVersion || "1.0.0",
        plan: u.plan || "free",
        premiumStatus: !!u.premiumStatus,
        lastSeen: lastSeen ? lastSeen.toISOString() : null,
        createdDate: u.createdDate,
        updatedDate: u.updatedDate
      });
    });

    // Apply Search
    if (search) {
      const searchLower = search.toLowerCase();
      users = users.filter(u => 
        u.uid.toLowerCase().includes(searchLower) || 
        u.clientUid.toLowerCase().includes(searchLower) ||
        u.country.toLowerCase().includes(searchLower)
      );
    }

    // Apply Plan Filter
    if (plan && plan !== "all") {
      users = users.filter(u => u.plan === plan);
    }

    // Apply Premium Status Filter
    if (premium && premium !== "all") {
      const isPremiumFilter = premium === "true";
      users = users.filter(u => u.premiumStatus === isPremiumFilter);
    }

    // Apply Sorting
    if (sortField) {
      const order = sortOrder === "desc" ? -1 : 1;
      users.sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];

        if (typeof valA === "string") {
          return valA.localeCompare(valB) * order;
        }
        
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        
        return (valA < valB ? -1 : valA > valB ? 1 : 0) * order;
      });
    } else {
      // Default: sort by installDate desc
      users.sort((a, b) => new Date(b.installDate) - new Date(a.installDate));
    }

    return res.status(200).json({ users });

  } catch (error) {
    console.error("Admin user list fetch error:", error);
    return res.status(500).json({ error: "Failed to load user records." });
  }
});

// PUT: Update System Settings (pricing, version details, maintenance state)
router.put("/settings", verifyAdminToken, async (req, res) => {
  const { 
    monthlyPrice, 
    yearlyPrice, 
    lifetimePrice, 
    trialDays, 
    extensionVersion, 
    maintenanceMode, 
    announcements,
    enablePremiumFeatures 
  } = req.body;

  try {
    const updateData = {};
    if (monthlyPrice !== undefined) updateData.monthlyPrice = Number(monthlyPrice);
    if (yearlyPrice !== undefined) updateData.yearlyPrice = Number(yearlyPrice);
    if (lifetimePrice !== undefined) updateData.lifetimePrice = Number(lifetimePrice);
    if (trialDays !== undefined) updateData.trialDays = Number(trialDays);
    if (extensionVersion !== undefined) updateData.extensionVersion = String(extensionVersion);
    if (maintenanceMode !== undefined) updateData.maintenanceMode = Boolean(maintenanceMode);
    if (announcements !== undefined) updateData.announcements = String(announcements);
    if (enablePremiumFeatures !== undefined) updateData.enablePremiumFeatures = Boolean(enablePremiumFeatures);

    await db.collection("settings").doc("global").set(updateData, { merge: true });
    
    return res.status(200).json({ 
      success: true, 
      message: "Global configuration settings successfully updated." 
    });

  } catch (error) {
    console.error("Admin settings update error:", error);
    return res.status(500).json({ error: "Failed to update global configurations." });
  }
});

module.exports = router;
