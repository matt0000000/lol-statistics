import { productionRouteHandlers } from "../../../../lib/route-factory";
type Context = { params: Promise<{ championId: string }> };
export async function GET(request: Request, context: Context) { return productionRouteHandlers().champion(request, context); }
