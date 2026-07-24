const { db } = require("../config/firebase");

let stripeInstance = null;

function getStripe() {
  if (!stripeInstance && process.env.STRIPE_SECRET_KEY) {
    try {
      stripeInstance = require("stripe")(process.env.STRIPE_SECRET_KEY);
    } catch (e) {
      console.warn("Stripe package import error:", e.message);
    }
  }
  return stripeInstance;
}

function isStripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY;
  return !!(key && key.trim().startsWith("sk_"));
}

// Payment Service: Generates checkout sessions (real Stripe Live/Test or simulated mock)
async function createCheckoutSession(uid, planId, successUrl, cancelUrl, requestHost) {
  // 1. Fetch live pricing configuration
  let prices = { monthlyPrice: 4.99, yearlyPrice: 29.99, lifetimePrice: 79.99 };
  try {
    const docSnap = await db.collection("settings").doc("global").get();
    if (docSnap.exists) {
      prices = docSnap.data();
    }
  } catch (err) {
    console.warn("Using default pricing rules (Firestore read fallback):", err.message);
  }

  let priceValue = 4.99;
  let isSubscription = true;

  if (planId === "monthly") {
    priceValue = prices.monthlyPrice || 4.99;
    isSubscription = true;
  } else if (planId === "yearly") {
    priceValue = prices.yearlyPrice || 29.99;
    isSubscription = true;
  } else if (planId === "lifetime") {
    priceValue = prices.lifetimePrice || 79.99;
    isSubscription = false;
  }

  const stripe = getStripe();

  // 2. Real Stripe Workflow (Live or Test mode depending on STRIPE_SECRET_KEY)
  if (isStripeConfigured() && stripe) {
    try {
      const lineItemPriceData = {
        currency: "usd",
        unit_amount: Math.round(priceValue * 100), // Stripe takes amounts in cents
        product_data: {
          name: planId === "lifetime" ? "Lifetime Access" : `Premium ${planId === "yearly" ? "Yearly" : "Monthly"} Plan`,
        },
      };

      if (isSubscription) {
        lineItemPriceData.recurring = { interval: planId === "yearly" ? "year" : "month" };
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: lineItemPriceData,
            quantity: 1,
          },
        ],
        mode: isSubscription ? "subscription" : "payment",
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        client_reference_id: uid,
        metadata: { planId, uid }
      });

      return {
        isMock: false,
        sessionId: session.id,
        checkoutUrl: session.url
      };
    } catch (error) {
      console.error("Stripe Checkout Session generation error:", error.message);
      throw new Error(`Stripe Live Checkout Error: ${error.message}`);
    }
  }

  // 3. Fallback Mock Simulator Workflow (If Stripe environment keys are absent)
  const mockSessionId = `mock_session_${Math.random().toString(36).substring(2, 15)}`;
  const backendBaseUrl = process.env.BACKEND_URL || requestHost || "http://localhost:5000";
  
  // Custom mock simulator page hosted on backend
  const checkoutUrl = `${backendBaseUrl}/api/payments/mock-checkout?session_id=${mockSessionId}&uid=${uid}&plan=${planId}&price=${priceValue}&successUrl=${encodeURIComponent(successUrl)}&cancelUrl=${encodeURIComponent(cancelUrl)}`;

  return {
    isMock: true,
    sessionId: mockSessionId,
    checkoutUrl: checkoutUrl
  };
}

module.exports = {
  createCheckoutSession,
  isStripeConfigured,
  getStripe
};
