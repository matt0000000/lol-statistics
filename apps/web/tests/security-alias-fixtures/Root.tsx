// @ts-nocheck
"use client";
import { staticSecret } from "@fixture/static";
import { dynamicSecret } from "@fixture/dynamic";
export { reExportedSecret } from "@fixture/re-export";
const requiredSecret = require("@fixture/required");
void import("@exact");
export const root = [staticSecret, dynamicSecret, requiredSecret];
