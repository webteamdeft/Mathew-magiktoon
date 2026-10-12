import { authenticate } from "../shopify.server";
import { testGelatoConnection } from "../lib/gelato.server";

export async function loader({ request }) {
  await authenticate.admin(request);

  try {
    const result = await testGelatoConnection();

    return Response.json({
      ok: true,
      message: "Gelato connection is working",
      result,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error.message,
      },
      { status: 502 }
    );
  }
}