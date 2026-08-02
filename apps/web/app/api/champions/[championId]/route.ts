import { productionRouteHandlers } from "../../../../lib/route-factory";
import { headResponse, methodNotAllowed, optionsResponse } from "../../../../lib/api-routes";
type Context = { params: Promise<{ championId: string }> };
export async function GET(request: Request, context: Context) { return productionRouteHandlers().champion(request, context); }
export async function HEAD(request: Request, context: Context) { return headResponse(request, productionRouteHandlers().champion, context); }
export function POST(_request: Request, _context: Context) { return methodNotAllowed(); }
export function PUT(_request: Request, _context: Context) { return methodNotAllowed(); }
export function PATCH(_request: Request, _context: Context) { return methodNotAllowed(); }
export function DELETE(_request: Request, _context: Context) { return methodNotAllowed(); }
export function OPTIONS(_request: Request, _context: Context) { return optionsResponse(); }
