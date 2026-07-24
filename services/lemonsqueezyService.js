const crypto = require("crypto");
const { handleUserUpgrade } = require("./webhookService");

// LemonSqueezy Webhook Signature Verifier (HMAC-SHA256)
function verifyLemonSqueezySignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  try {
    const hmac = crypto.createHmac("sha256", secret);
    const digest = hmac.update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch (err) {
    console.error("LemonSqueezy signature verification failed:", err.message);
    return false;
  }
}

// Process incoming LemonSqueezy webhook events
async function processLemonSqueezyEvent(payload) {
  const meta = payload.meta || {};
  const eventName = meta.event_name;
  const customData = meta.custom_data || {};
  const attributes = (payload.data && payload.data.attributes) || {};

  console.log(`Processing LemonSqueezy event: ${eventName}`);

  const uid = customData.uid || customData.user_id;
  const planId = customData.planId || customData.plan_id || "pro";

  if (!uid) {
    console.warn("LemonSqueezy event received without client UID in custom_data");
    return false;
  }

  switch (eventName) {
    case "order_created":
    case "subscription_created":
    case "subscription_updated": {
      const status = attributes.status || "active";
      if (status === "active" || status === "paid" || eventName === "order_created") {
        console.log(`Upgrading user ${uid} via LemonSqueezy for plan: ${planId}`);
        await handleUserUpgrade(uid, planId);
      }
      break;
    }
    default:
      console.log(`Unhandled LemonSqueezy event type: ${eventName}`);
  }

  return true;
}

module.exports = {
  verifyLemonSqueezySignature,
  processLemonSqueezyEvent
};
