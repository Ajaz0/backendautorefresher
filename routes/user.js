const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { db, getTimestampDate } = require("../config/firebase");
const { verifyUserToken } = require("../middleware/auth");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_default_secret_key_for_local_testing_purposes";

// Generate a random UUID
function generateUUID() {
  return crypto.randomBytes(16).toString("hex");
}

// REST: Authenticate user, verify/fingerprint, prevent trial reset
router.post("/authenticate", async (req, res) => {
  const { clientUid, fingerprint, browserVersion, extensionVersion, country } = req.body;

  if (!fingerprint) {
    return res.status(400).json({ error: "Fingerprint is required." });
  }

  try {
    let userDoc = null;
    let userId = null;

    // 1. Try finding user by clientUid (Chrome sync storage)
    if (clientUid) {
      const userRef = db.collection("users").doc(clientUid);
      const docSnap = await userRef.get();
      if (docSnap.exists) {
        userDoc = docSnap.data();
        userId = docSnap.id;
      }
    }

    // 2. If not found by clientUid, search by hardware fingerprint
    if (!userDoc) {
      const fingerprintQuery = await db.collection("users")
        .where("fingerprint", "==", fingerprint)
        .limit(1)
        .get();

      if (!fingerprintQuery.empty) {
        const doc = fingerprintQuery.docs[0];
        userDoc = doc.data();
        userId = doc.id;
        console.log(`Matched returning user ${userId} via fingerprint check.`);
      }
    }

    // Get current global settings for trial length & status
    const settingsSnap = await db.collection("settings").doc("global").get();
    const globalSettings = settingsSnap.exists 
      ? settingsSnap.data() 
      : { trialDays: 10, enablePremiumFeatures: true };

    const trialDays = globalSettings.trialDays || 10;

    // 3. Register as a new user if still not found
    if (!userDoc) {
      userId = clientUid || `usr_${generateUUID()}`;
      const now = new Date();
      const trialEndDate = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

      userDoc = {
        uid: userId,
        clientUid: clientUid || userId,
        fingerprint: fingerprint,
        installDate: now.toISOString(),
        trialStart: now.toISOString(),
        trialEnd: trialEndDate.toISOString(),
        plan: "free",
        premiumStatus: false,
        country: country || "Unknown",
        browserVersion: browserVersion || "Unknown",
        extensionVersion: extensionVersion || "1.0.0",
        lastSeen: now.toISOString(),
        createdDate: now.toISOString(),
        updatedDate: now.toISOString()
      };

      await db.collection("users").doc(userId).set(userDoc);
      console.log(`Registered new user ${userId} with ${trialDays}-day trial.`);
    } else {
      // Update last seen & system versions
      userDoc.lastSeen = new Date().toISOString();
      if (browserVersion) userDoc.browserVersion = browserVersion;
      if (extensionVersion) userDoc.extensionVersion = extensionVersion;
      if (country) userDoc.country = country;
      userDoc.updatedDate = new Date().toISOString();

      await db.collection("users").doc(userId).update({
        lastSeen: userDoc.lastSeen,
        browserVersion: userDoc.browserVersion,
        extensionVersion: userDoc.extensionVersion,
        country: userDoc.country,
        updatedDate: userDoc.updatedDate
      });
    }

    // Calculate trial details
    const trialEnd = getTimestampDate(userDoc.trialEnd);
    const now = new Date();
    const isTrialExpired = now > trialEnd;
    const diffTime = trialEnd.getTime() - now.getTime();
    const remainingDays = isTrialExpired ? 0 : Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Evaluate premium privileges: either explicitly premium, or within trial window (unless premium features are disabled)
    const isPremium = userDoc.premiumStatus === true;
    const isTrialActive = !isTrialExpired;
    const hasPremiumAccess = (isPremium || isTrialActive) && (globalSettings.enablePremiumFeatures !== false);

    // Issue user JWT
    const token = jwt.sign({ uid: userId, role: "user" }, JWT_SECRET, { expiresIn: "30d" });

    return res.status(200).json({
      token,
      userStatus: {
        uid: userId,
        plan: userDoc.plan,
        premiumStatus: isPremium,
        hasPremiumAccess: hasPremiumAccess,
        isTrialExpired,
        remainingDays,
        trialEnd: trialEnd.toISOString(),
        installDate: getTimestampDate(userDoc.installDate).toISOString()
      },
      globalSettings: {
        maintenanceMode: globalSettings.maintenanceMode || false,
        announcements: globalSettings.announcements || "",
        enablePremiumFeatures: globalSettings.enablePremiumFeatures !== false
      }
    });

  } catch (error) {
    console.error("Authentication router error:", error);
    return res.status(500).json({ error: "Failed to authenticate client." });
  }
});

// GET: Check live trial & premium user status
router.get("/status", verifyUserToken, async (req, res) => {
  try {
    const userRef = db.collection("users").doc(req.user.uid);
    const docSnap = await userRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: "User profile not found." });
    }

    const userDoc = docSnap.data();

    // Fetch live global config
    const settingsSnap = await db.collection("settings").doc("global").get();
    const globalSettings = settingsSnap.exists 
      ? settingsSnap.data() 
      : { enablePremiumFeatures: true };

    const trialEnd = getTimestampDate(userDoc.trialEnd);
    const now = new Date();
    const isTrialExpired = now > trialEnd;
    const diffTime = trialEnd.getTime() - now.getTime();
    const remainingDays = isTrialExpired ? 0 : Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const isPremium = userDoc.premiumStatus === true;
    const isTrialActive = !isTrialExpired;
    const hasPremiumAccess = (isPremium || isTrialActive) && (globalSettings.enablePremiumFeatures !== false);

    // Update user's last seen timestamp
    await userRef.update({
      lastSeen: now.toISOString(),
      updatedDate: now.toISOString()
    });

    return res.status(200).json({
      userStatus: {
        uid: userDoc.uid,
        plan: userDoc.plan,
        premiumStatus: isPremium,
        hasPremiumAccess: hasPremiumAccess,
        isTrialExpired,
        remainingDays,
        trialEnd: trialEnd.toISOString(),
        installDate: getTimestampDate(userDoc.installDate).toISOString()
      },
      globalSettings: {
        maintenanceMode: globalSettings.maintenanceMode || false,
        announcements: globalSettings.announcements || "",
        enablePremiumFeatures: globalSettings.enablePremiumFeatures !== false
      }
    });

  } catch (error) {
    console.error("Fetch status router error:", error);
    return res.status(500).json({ error: "Internal server error check status." });
  }
});

module.exports = router;
