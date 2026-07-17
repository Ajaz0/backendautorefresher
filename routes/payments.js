const express = require("express");
const router = express.Router();
const { verifyUserToken } = require("../middleware/auth");
const { createCheckoutSession, isStripeConfigured } = require("../services/paymentService");
const { processStripeEvent, handleUserUpgrade } = require("../services/webhookService");

let stripe = null;
if (isStripeConfigured()) {
  try {
    stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  } catch (e) { /* ignore */ }
}

// POST: Create checkout session
router.post("/checkout-session", verifyUserToken, async (req, res) => {
  const { planId, successUrl, cancelUrl } = req.body;
  const uid = req.user.uid;

  if (!planId || !["monthly", "yearly", "lifetime"].includes(planId)) {
    return res.status(400).json({ error: "Invalid subscription plan selected." });
  }

  try {
    const session = await createCheckoutSession(uid, planId, successUrl, cancelUrl);
    return res.status(200).json(session);
  } catch (error) {
    console.error("Failed to start payment checkout session:", error);
    return res.status(500).json({ error: "Checkout session initiation failed." });
  }
});

// POST: Handle real Stripe webhook incoming triggers
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

// GET: Serve interactive checkout simulator (for free tier testing)
router.get("/mock-checkout", (req, res) => {
  const { uid, plan, price, successUrl, cancelUrl } = req.query;

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Simulator (Stripe Development Portal)</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: 'Outfit', sans-serif;
          background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
          color: #f8fafc;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .container {
          background: rgba(30, 41, 59, 0.7);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 40px;
          max-width: 480px;
          width: 90%;
          text-align: center;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        }
        h2 {
          color: #38bdf8;
          font-size: 26px;
          margin-bottom: 10px;
        }
        p {
          font-size: 16px;
          color: #94a3b8;
          line-height: 1.6;
        }
        .badge {
          background: rgba(56, 189, 248, 0.1);
          color: #38bdf8;
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 12px;
          padding: 6px 12px;
          font-size: 14px;
          font-weight: 600;
          display: inline-block;
          margin: 15px 0;
        }
        .billing-box {
          background: rgba(15, 23, 42, 0.5);
          border-radius: 12px;
          padding: 20px;
          margin: 20px 0;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .billing-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 10px;
          font-size: 15px;
        }
        .billing-row:last-child {
          margin-bottom: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 10px;
          font-weight: 700;
          font-size: 18px;
          color: #f8fafc;
        }
        .btn {
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          border: none;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-top: 10px;
        }
        .btn-primary {
          background: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%);
          color: #0f172a;
          box-shadow: 0 4px 14px rgba(0, 242, 254, 0.3);
        }
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0, 242, 254, 0.5);
        }
        .btn-cancel {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #94a3b8;
          margin-top: 15px;
        }
        .btn-cancel:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #f8fafc;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>💳 Checkout Portal</h2>
        <span class="badge">Development & Sandbox Simulator</span>
        <p>You are deploying a simulated subscription upgrade. No actual credit card details are billed.</p>

        <div class="billing-box">
          <div class="billing-row">
            <span>User ID:</span>
            <span style="font-family: monospace; font-size: 12px; color: #f8fafc;">${uid}</span>
          </div>
          <div class="billing-row">
            <span>Plan:</span>
            <span style="text-transform: capitalize;">${plan} Access</span>
          </div>
          <div class="billing-row">
            <span>Amount:</span>
            <span>$${price} USD</span>
          </div>
        </div>

        <button id="pay-btn" class="btn btn-primary">Complete Mock Payment</button>
        <button id="cancel-btn" class="btn btn-cancel">Cancel Checkout</button>
      </div>

      <script>
        document.getElementById("pay-btn").addEventListener("click", async () => {
          document.getElementById("pay-btn").textContent = "Processing...";
          document.getElementById("pay-btn").disabled = true;

          try {
            const res = await fetch("/api/payments/mock-checkout/confirm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uid: "${uid}", plan: "${plan}" })
            });
            const data = await res.json();
            if (data.success) {
              window.location.href = "${decodeURIComponent(successUrl)}";
            } else {
              alert("Payment confirmation failed: " + data.error);
            }
          } catch(e) {
            alert("Error running checkout simulator: " + e.message);
          }
        });

        document.getElementById("cancel-btn").addEventListener("click", () => {
          window.location.href = "${decodeURIComponent(cancelUrl)}";
        });
      </script>
    </body>
    </html>
  `;
  return res.send(html);
});

// POST: Sandbox confirm endpoint for simulated payments
router.post("/mock-checkout/confirm", async (req, res) => {
  const { uid, plan } = req.body;

  if (!uid || !plan) {
    return res.status(400).json({ error: "Missing checkout parameters." });
  }

  try {
    const success = await handleUserUpgrade(uid, plan);
    if (success) {
      return res.status(200).json({ success: true });
    } else {
      return res.status(500).json({ error: "Mock update failed in database hooks." });
    }
  } catch (err) {
    console.error("Mock checkout confirm crash:", err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
