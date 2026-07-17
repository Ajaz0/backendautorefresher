const { db } = require("../config/firebase");

let stripe = null;
const isStripeConfigured = !!process.env.STRIPE_SECRET_KEY;

if (isStripeConfigured) {
  try {
    // Stripe SDK loaded dynamically if configuration keys are present
    stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.warn("Stripe package import error. Continuing in simulator mode.");
  }
}

// Payment Service: Generates checkout sessions (real or simulated)
async function createCheckoutSession(uid, planId, successUrl, cancelUrl, requestHost) {
  // 1. Fetch live pricing configuration
  const docSnap = await db.collection("settings").doc("global").get();
  const prices = docSnap.exists 
    ? docSnap.data() 
    : { monthlyPrice: 4.99, yearlyPrice: 29.99, lifetimePrice: 79.99 };

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

  // 2. Real Stripe Workflow
  if (isStripeConfigured && stripe) {
    try {
      // Build dynamic Stripe Price Object
      const priceObject = await stripe.prices.create({
        currency: "usd",
        unit_amount: Math.round(priceValue * 100), // Stripe takes amounts in cents
        recurring: isSubscription ? { interval: planId === "yearly" ? "year" : "month" } : undefined,
        product_data: {
          name: planId === "lifetime" ? "Lifetime Access" : `Premium ${planId === "yearly" ? "Yearly" : "Monthly"} Plan`,
        },
      });

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{ price: priceObject.id, quantity: 1 }],
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
      console.error("Stripe Checkout Session generation failed, falling back to simulator:", error.message);
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
  isStripeConfigured: () => isStripeConfigured
};
