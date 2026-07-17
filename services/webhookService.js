const { db } = require("../config/firebase");

// Webhook Service: Handles DB status updates for subscription lifecycle events
async function handleUserUpgrade(uid, plan) {
  try {
    const userRef = db.collection("users").doc(uid);
    const now = new Date();
    
    // In premium plans, we extend trialEnd to distant future or record it
    const trialEndDate = new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000); // 100 years for lifetime/active subscriptions

    await userRef.update({
      plan: plan,
      premiumStatus: true,
      trialEnd: trialEndDate.toISOString(), // ensure no expired blocks
      updatedDate: now.toISOString()
    });

    console.log(`Database Upgraded: User ${uid} is now on ${plan} plan.`);
    return true;
  } catch (error) {
    console.error(`Failed to execute DB upgrade for user ${uid}:`, error.message);
    return false;
  }
}

async function handleUserDowngrade(uid) {
  try {
    const userRef = db.collection("users").doc(uid);
    const now = new Date();
    
    // Revert plan to free and set trial expiration to elapsed time (expired)
    await userRef.update({
      plan: "free",
      premiumStatus: false,
      trialEnd: now.toISOString(), // instantly expire trial
      updatedDate: now.toISOString()
    });

    console.log(`Database Downgraded: User ${uid} reverted to free status.`);
    return true;
  } catch (error) {
    console.error(`Failed to execute DB downgrade for user ${uid}:`, error.message);
    return false;
  }
}

// Process actual Stripe Event hooks
async function processStripeEvent(event) {
  const session = event.data.object;
  console.log(`Stripe Event received: ${event.type}`);

  switch (event.type) {
    case "checkout.session.completed": {
      const uid = session.client_reference_id || session.metadata?.uid;
      const plan = session.metadata?.planId || "monthly";
      if (uid) {
        await handleUserUpgrade(uid, plan);
      }
      break;
    }
    case "invoice.payment_succeeded": {
      // Re-activate or confirm active subscription status
      const subscriptionId = session.subscription;
      // Stripe subscription query if needed, otherwise rely on client ref/metadata
      if (session.metadata?.uid) {
        const uid = session.metadata.uid;
        const plan = session.metadata.planId || "monthly";
        await handleUserUpgrade(uid, plan);
      }
      break;
    }
    case "invoice.payment_failed":
    case "customer.subscription.deleted": {
      // Suspend access
      if (session.metadata?.uid) {
        const uid = session.metadata.uid;
        await handleUserDowngrade(uid);
      }
      break;
    }
    case "charge.refunded": {
      // Revert premium status on refund
      if (session.metadata?.uid) {
        const uid = session.metadata.uid;
        await handleUserDowngrade(uid);
      }
      break;
    }
    default:
      console.log(`Unhandled Stripe hook type: ${event.type}`);
  }
}

module.exports = {
  processStripeEvent,
  handleUserUpgrade,
  handleUserDowngrade
};
