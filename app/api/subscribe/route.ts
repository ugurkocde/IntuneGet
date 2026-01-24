import { NextResponse } from "next/server";

const BEEHIIV_API_KEY = process.env.BEEHIIV_API_KEY;
const PUBLICATION_ID = "pub_af0b166d-8a49-4c6e-8cc8-ae698af40f4a";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    // Gracefully handle when newsletter is not configured (self-hosted without Beehiiv)
    if (!BEEHIIV_API_KEY) {
      return NextResponse.json(
        {
          message: "Newsletter subscription is not available in this deployment",
          configured: false
        },
        { status: 200 }
      );
    }

    const response = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/subscriptions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BEEHIIV_API_KEY}`,
        },
        body: JSON.stringify({
          email,
          reactivate_existing: false,
          send_welcome_email: true,
          utm_source: "website",
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
  }
}
