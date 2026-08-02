import { productionRouteHandlers } from "../../../lib/route-factory";
import { headResponse, methodNotAllowed, optionsResponse } from "../../../lib/api-routes";
export async function GET(request: Request) { return productionRouteHandlers().champions(request); }
export async function HEAD(request: Request) { return headResponse(request, productionRouteHandlers().champions); }
export function POST(_request: Request) { return methodNotAllowed(); }
export function PUT(_request: Request) { return methodNotAllowed(); }
export function PATCH(_request: Request) { return methodNotAllowed(); }
export function DELETE(_request: Request) { return methodNotAllowed(); }
export function OPTIONS(_request: Request) { return optionsResponse(); }
