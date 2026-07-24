const express = require("express");
const router = express.Router();
const { verifyUserToken } = require("../middleware/auth");
const { createCheckoutSession, isStripeConfigured, getStripe } = require("../services/paymentService");
const { processStripeEvent, handleUserUpgrade } = require("../services/webhookService");

// POST: Create checkout session
router.post("/checkout-session", verifyUserToken, async (req, res) => {
  const { planId, successUrl, cancelUrl } = req.body;
  const uid = req.user.uid;

  if (!planId || !["monthly", "yearly", "lifetime"].includes(planId)) {
    return res.status(400).json({ error: "Invalid subscription plan selected." });
  }

  try {
    const requestHost = `${req.protocol}://${req.get("host")}`;
    const session = await createCheckoutSession(uid, planId, successUrl, cancelUrl, requestHost);
    return res.status(200).json(session);
  } catch (error) {
    console.error("Failed to start payment checkout session:", error);
    return res.status(500).json({ error: error.message || "Checkout session initiation failed." });
  }
});

// POST: Handle real Stripe webhook incoming triggers
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripe();

  let event;

  if (isStripeConfigured() && stripe && sig && webhookSecret) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.warn(`Stripe signature validation failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // If webhook signature parsing is absent, parse standard payload directly (for testing/development only)
    try {
      event = JSON.parse(req.body);
    } catch (e) {
      return res.status(400).send("Payload parser error.");
    }
  }

  try {
    await processStripeEvent(event);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Stripe event webhook handler crashed:", error);
    return res.status(500).json({ error: "Webhook processor error." });
  }
});
