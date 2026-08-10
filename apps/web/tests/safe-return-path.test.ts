import { describe, expect, test } from "bun:test";

import {
	SAFE_RETURN_PATHS,
	safeReturnPath,
	signInPath,
} from "../src/lib/safe-return";

describe("safeReturnPath allowlist", () => {
	test("accepts every allowlisted destination unchanged", () => {
		for (const path of SAFE_RETURN_PATHS) {
			expect(safeReturnPath(path), `allowlisted ${path}`).toBe(path);
		}
	});

	test.each([
		["absolute external URL", "https://evil.example/dashboard"],
		["protocol-relative URL", "//evil.example"],
		["encoded protocol-relative URL", "%2F%2Fevil.example"],
		["encoded absolute URL", "https%3A%2F%2Fevil.example"],
		["path traversal", "/dashboard/../admin/platform"],
		["non-allowlisted internal path", "/admin/platform/bindings"],
		["trailing slash variant", "/dashboard/"],
		["case variant", "/Dashboard"],
		["leading whitespace", " /dashboard"],
		["trailing whitespace", "/dashboard "],
		["nested child of an allowlisted path", "/admin/platform/users/extra"],
		["javascript scheme", "javascript:alert(1)"],
		["backslash bypass attempt", "/\\evil.example"],
	])("rejects %s", (_label, value) => {
		expect(safeReturnPath(value)).toBeUndefined();
	});

	test("rejects non-string input", () => {
		expect(safeReturnPath(undefined)).toBeUndefined();
		expect(safeReturnPath(null)).toBeUndefined();
		expect(safeReturnPath(42)).toBeUndefined();
		expect(safeReturnPath({})).toBeUndefined();
		expect(safeReturnPath(["/dashboard"])).toBeUndefined();
	});
});

describe("signInPath", () => {
	test("falls back to the fixed dashboard destination", () => {
		expect(signInPath()).toBe("/sign-in?returnTo=%2Fdashboard");
	});

	test("encodes only allowlisted destinations", () => {
		expect(signInPath("/admin/platform")).toBe(
			"/sign-in?returnTo=%2Fadmin%2Fplatform",
		);
		expect(signInPath("/organizations")).toBe(
			"/sign-in?returnTo=%2Forganizations",
		);
	});
});
