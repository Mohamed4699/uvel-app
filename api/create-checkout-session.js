import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-03-25.preview'
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const {
      bookingId,
      pickup,
      destination,
      fare,
      passengerEmail,
      passengerName,
      rideType
    } = req.body || {};

    if (!bookingId || !fare || Number(fare) <= 0) {
      return res.status(400).json({ error: 'Missing bookingId or fare' });
    }
    if (rideType === 'ndis') {
      return res.status(400).json({ error: 'NDIS trips must not use Stripe checkout' });
    }

    const origin = req.headers.origin || process.env.APP_BASE_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${origin}?payment=success&session_id={CHECKOUT_SESSION_ID}&bookingId=${encodeURIComponent(bookingId)}`,
      cancel_url: `${origin}?payment=cancelled&bookingId=${encodeURIComponent(bookingId)}`,
      customer_email: passengerEmail || undefined,
      client_reference_id: bookingId,
      metadata: {
        bookingId,
        passengerName: passengerName || '',
        pickup: pickup || '',
        destination: destination || ''
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'aud',
            product_data: {
              name: 'UVEL Community Transport',
              description: `${pickup || 'Pickup'} → ${destination || 'Destination'}`
            },
            unit_amount: Math.round(Number(fare) * 100)
          }
        }
      ]
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error('create-checkout-session error', error);
    return res.status(500).json({ error: error.message || 'Checkout session creation failed' });
  }
}
