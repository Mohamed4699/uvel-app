import Stripe from "stripe";
import admin from "firebase-admin";

export const config = {
  api: {
    bodyParser: false
  }
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getFirebasePrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY || "";
  return key.replace(/\\n/g, "\n");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: getFirebasePrivateKey()
    })
  });
}

const db = admin.firestore();

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return res.status(400).send("Missing Stripe signature");
  }

  let event;

  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;

      const bookingId =
        session.client_reference_id ||
        session.metadata?.bookingId ||
        null;

      if (!bookingId) {
        console.warn("No bookingId found in Stripe session metadata");
        return res.status(200).json({ received: true, warning: "No bookingId" });
      }

      const bookingRef = db.collection("bookings").doc(bookingId);
      const paymentRef = db.collection("payments").doc(session.id);

      await db.runTransaction(async (tx) => {
        const bookingSnap = await tx.get(bookingRef);

        if (!bookingSnap.exists) {
          throw new Error(`Booking ${bookingId} not found`);
        }

        const bookingData = bookingSnap.data() || {};
        const alreadyPaid = bookingData.paymentStatus === "paid";

        tx.set(
          paymentRef,
          {
            stripeSessionId: session.id,
            bookingId,
            paymentStatus: session.payment_status || "paid",
            amountTotal: session.amount_total || 0,
            currency: session.currency || "aud",
            customerEmail:
              session.customer_details?.email ||
              session.customer_email ||
              null,
            customerName: session.customer_details?.name || null,
            stripePaymentIntent: session.payment_intent || null,
            metadata: session.metadata || {},
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            eventType: event.type
          },
          { merge: true }
        );

        if (!alreadyPaid) {
          tx.update(bookingRef, {
            paymentStatus: "paid",
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            paymentCompletedAt: new Date().toISOString(),
            stripeSessionId: session.id,
            stripePaymentIntent: session.payment_intent || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });

      console.log(`Booking ${bookingId} marked as PAID`);
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const bookingId =
        session.client_reference_id ||
        session.metadata?.bookingId ||
        null;

      if (bookingId) {
        await db.collection("bookings").doc(bookingId).set(
          {
            paymentStatus: "unpaid",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.status(500).send("Webhook processing failed");
  }
}
