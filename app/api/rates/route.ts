import { NextResponse } from "next/server";
import { usdRates } from "@/lib/server/rates";

export const runtime = "nodejs";

/** Units per 1 USD, for converting expenses to the trip currency on the client. Public data, so no auth. */
export async function GET() {
  return NextResponse.json({ rates: await usdRates() }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=43200" } });
}
