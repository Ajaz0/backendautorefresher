const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

// GET: Fetch live dynamic pricing configuration from Firestore
router.get("/plans", async (req, res) => {
  try {
    const docSnap = await db.collection("settings").doc("global").get();
    
    let prices = {
      monthlyPrice: 4.99,
      yearlyPrice: 29.99,
      lifetimePrice: 79.99
    };

    if (docSnap.exists) {
      const data = docSnap.data();
      if (data.monthlyPrice !== undefined) prices.monthlyPrice = Number(data.monthlyPrice);
      if (data.yearlyPrice !== undefined) prices.yearlyPrice = Number(data.yearlyPrice);
      if (data.lifetimePrice !== undefined) prices.lifetimePrice = Number(data.lifetimePrice);
    } else {
      // If settings document doesn't exist, create it with default prices
      await db.collection("settings").doc("global").set({
        ...prices,
        trialDays: 10,
        extensionVersion: "1.0.0",
        maintenanceMode: false,
        announcements: "Welcome to Advanced Auto Refresh Premium!",
        enablePremiumFeatures: true
      });
    }

    // Return subscription plan configuration
    return res.status(200).json({
      plans: [
        {
          id: "monthly",
          name: "Premium Monthly",
          price: prices.monthlyPrice,
          interval: "month",
          description: "Full Premium features billed monthly. Cancel anytime."
        },
        {
          id: "yearly",
          name: "Premium Yearly",
          price: prices.yearlyPrice,
          interval: "year",
          description: "Save big! Full Premium features billed annually."
        },
        {
          id: "lifetime",
          name: "Lifetime Access",
          price: prices.lifetimePrice,
          interval: "one-time",
          description: "Pay once. Full Premium features forever, including all future updates."
        }
      ]
    });

  } catch (error) {
    console.error("Pricing fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch pricing plans." });
  }
});

module.exports = router;
