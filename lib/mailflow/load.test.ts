import { describe, it, expect, vi } from "vitest";
import { createLoader, describeLoadError } from "./load";

const pg = (code: string, message = "pg says no") => Object.assign(new Error(message), { code });
const drizzle = (cause: Error) =>
  Object.assign(new Error('Failed query: select "id" from "campaigns"\nparams: michael@mankinfinance.com'), { cause });

describe("describeLoadError", () => {
  it("sends a missing table or column to Set up the tables", () => {
    expect(describeLoadError(drizzle(pg("42P01"))).fix).toContain("Set up the tables");
    const column = describeLoadError(drizzle(pg("42703", 'column "variant" does not exist')));
    expect(column.message).toContain("missing a column");
    expect(column.fix).toContain("Set up the tables");
  });

  it("sends an unreachable database or a wrong password to Test connections", () => {
    expect(describeLoadError(pg("ECONNREFUSED")).fix).toContain("Test connections");
    expect(describeLoadError(pg("28P01")).message).toContain("password");
  });

  it("uses the database's reason, not the query and its values", () => {
    const d = describeLoadError(drizzle(pg("XX000", "division by zero")));
    expect(d.message).toBe("division by zero");
    expect(JSON.stringify(d)).not.toContain("michael@");
  });

  it("never shows a connection string", () => {
    const d = describeLoadError(new Error("connect to postgres://user:secret@db.example:5432/x failed"));
    expect(d.message).not.toContain("secret");
    expect(d.message).toContain("[address]");
  });
});

describe("createLoader", () => {
  it("falls back, records the failure once, and keeps the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { load, failures } = createLoader();
    const [a, b, c] = await Promise.all([
      load("Campaigns", async () => { throw pg("42703"); }, []),
      load("Campaigns", async () => { throw pg("42703"); }, []),
      load("Forms", async () => ["form"], []),
    ]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(c).toEqual(["form"]);
    expect(failures.map((f) => f.source)).toEqual(["Campaigns"]);
  });

  it("applies the database updates once and retries when a column is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const heal = vi.fn(async () => true);
    const { load, failures } = createLoader({ heal });
    let calls = 0;
    const value = await load("Campaign recipients", async () => {
      calls += 1;
      if (calls === 1) throw drizzle(pg("42703"));
      return ["row"];
    }, []);
    expect(value).toEqual(["row"]);
    expect(heal).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);
  });

  it("doesn't try to heal other errors, and reports when healing didn't help", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const heal = vi.fn(async () => false);
    const { load, failures } = createLoader({ heal });
    await load("Deals", async () => { throw pg("ECONNREFUSED"); }, []);
    expect(heal).not.toHaveBeenCalled();
    await load("Forms", async () => { throw pg("42P01"); }, []);
    expect(heal).toHaveBeenCalledTimes(1);
    expect(failures.map((f) => f.source)).toEqual(["Deals", "Forms"]);
  });
});
