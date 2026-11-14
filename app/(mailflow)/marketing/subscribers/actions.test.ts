import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/current-broker", () => ({
  currentBroker: async () => ({ id: "mm", name: "Michael Mankin" }),
}));
vi.mock("@/lib/auth/permissions", () => ({ canAccessAdmin: async () => true }));
vi.mock("@/lib/audit", () => ({ auditLog: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, unstable_cache: (fn: unknown) => fn }));

const { addContactsAction, removeFromListAction, setContactDateAction } = await import("./actions");
const { repos } = await import("@/lib/db/repos");

const base = { consentNote: "Signed up at the March seminar", brokerId: "mm", origin: "import" as const };

beforeEach(async () => {
  for (const c of await repos().marketingContact.list()) await repos().marketingContact.remove(c.email);
});

describe("adding to your own list", () => {
  it("adds valid addresses once, with who and why", async () => {
    const r = await addContactsAction({
      ...base,
      rows: [
        { email: "Jo@Example.com", name: "Jo Park" },
        { email: "jo@example.com" },
        { email: "nope" },
      ],
    });
    expect(r).toMatchObject({ ok: true, added: 1, rejected: 1 });
    const row = await repos().marketingContact.get("jo@example.com");
    expect(row).toMatchObject({ name: "Jo Park", origin: "import", consentNote: base.consentNote, createdBy: "mm" });
  });

  it("never overwrites someone already on the list", async () => {
    await addContactsAction({ ...base, rows: [{ email: "a@example.com", name: "First" }] });
    const r = await addContactsAction({ ...base, rows: [{ email: "a@example.com", name: "Second" }] });
    expect(r).toMatchObject({ ok: true, added: 0, alreadyOnList: 1 });
    expect((await repos().marketingContact.get("a@example.com"))?.name).toBe("First");
  });

  it("keeps an earlier opt-out in force", async () => {
    await repos().campaign.suppress({ email: "left@example.com" });
    const r = await addContactsAction({ ...base, rows: [{ email: "left@example.com" }] });
    expect(r).toMatchObject({ ok: true, added: 1, suppressed: 1 });
    expect((await repos().campaign.suppressedAmong(["left@example.com"])).size).toBe(1);
  });

  it("insists on a permission note and a real owner", async () => {
    expect(await addContactsAction({ ...base, consentNote: " ", rows: [{ email: "x@example.com" }] })).toMatchObject({ ok: false });
    expect(await addContactsAction({ ...base, brokerId: "someone", rows: [{ email: "x@example.com" }] })).toMatchObject({ ok: false });
  });

  it("removes someone from the list", async () => {
    await addContactsAction({ ...base, rows: [{ email: "gone@example.com" }] });
    expect(await removeFromListAction("Gone@example.com")).toEqual({ ok: true });
    expect(await repos().marketingContact.get("gone@example.com")).toBeNull();
  });
});

describe("key dates", () => {
  it("sets, changes and clears a date", async () => {
    expect(await setContactDateAction("Sarah@Example.com", "fixed-rate-expiry", "2027-02-14")).toEqual({ ok: true });
    expect(await repos().contactDate.forEmail("sarah@example.com")).toEqual({ "fixed-rate-expiry": "2027-02-14" });
    await setContactDateAction("sarah@example.com", "fixed-rate-expiry", null);
    expect(await repos().contactDate.forEmail("sarah@example.com")).toEqual({});
  });

  it("refuses unknown fields and impossible dates", async () => {
    expect(await setContactDateAction("s@example.com", "made-up", "2027-02-14")).toMatchObject({ ok: false });
    expect(await setContactDateAction("s@example.com", "fixed-rate-expiry", "2027-02-31")).toMatchObject({ ok: false });
  });

  it("takes dates from an import, for new and existing contacts", async () => {
    await addContactsAction({ ...base, rows: [{ email: "old@example.com" }] });
    const r = await addContactsAction({
      ...base,
      rows: [
        { email: "old@example.com", dates: { "fixed-rate-expiry": "2027-05-01" } },
        { email: "new@example.com", dates: { "fixed-rate-expiry": "2027-06-01", "made-up": "2027-01-01" } },
      ],
    });
    expect(r).toMatchObject({ ok: true, added: 1, alreadyOnList: 1, datesSet: 2 });
    expect(await repos().contactDate.forEmail("old@example.com")).toEqual({ "fixed-rate-expiry": "2027-05-01" });
  });
});
