import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-03-25.preview'
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { sessionId, bookingId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === 'paid';
    const matchesBooking = !bookingId || session.client_reference_id === bookingId || session.metadata?.bookingId === bookingId;

    return res.status(200).json({
      paid,
      matchesBooking,
      payment_status: session.payment_status,
      bookingId: session.client_reference_id || session.metadata?.bookingId || null,
      customer_email: session.customer_details?.email || session.customer_email || null
    });
  } catch (error) {
    console.error('verify-checkout-session error', error);
    return res.status(500).json({ error: error.message || 'Verification failed' });
  }
}
