"use client";
import staticSecret from "@round4/static";
const dynamicSecret = import("@round4/dynamic", { with: { type: "json" } });
const requiredSecret = require("@round4/required", "optional-argument");
export { reExportedSecret } from "@round4/re-export";
export const root = <section>{staticSecret}{dynamicSecret}{requiredSecret}</section>;
