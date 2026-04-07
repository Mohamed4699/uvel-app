export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const event = req.body;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      console.log("✅ PAYMENT SUCCESS");

      console.log("Amount:", session.amount_total / 100);
      console.log("Email:", session.customer_details?.email);
      console.log("Booking ID:", session.metadata?.bookingId);
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(400).send("Webhook error");
  }
}
