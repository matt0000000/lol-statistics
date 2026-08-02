import { productionRouteHandlers } from "../../../../../../../lib/route-factory";
type Context = { params: Promise<{ championId: string; role: string }> };
export async function GET(request: Request, context: Context) { return productionRouteHandlers().stats(request, context); }
