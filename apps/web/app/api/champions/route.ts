import { productionRouteHandlers } from "../../../lib/route-factory";
export async function GET(request: Request) { return productionRouteHandlers().champions(request); }
