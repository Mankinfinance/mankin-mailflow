import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  WebhookEventSchema,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENT_BLURBS,
} from "./types";

/** Every emit in these tests is captured rather than delivered. */
const emitted: { event: string; data: Record<string, unknown> }[] = [];

vi.mock("@/lib/webhooks/dispatch", () => ({
  emitWebhook: async (event: string, data: Record<string, unknown>) => {
    emitted.push({ event, data });
  },
}));

const { repos } = await import("@/lib/db/repos");
const { submitForm } = await import("@/lib/forms/submit");

beforeEach(() => {
  emitted.length = 0;
});

describe("the event catalogue", () => {
  it("labels and describes every event", () => {
    // The UI renders from these maps. A new event without both is a
    // blank row in the endpoint form.
    for (const event of WebhookEventSchema.options) {
      expect(WEBHOOK_EVENT_LABELS[event], event).toBeTruthy();
      expect(WEBHOOK_EVENT_BLURBS[event], event).toBeTruthy();
    }
  });

  it("names events as noun.verb, past tense", () => {
    // A receiver's switch statement reads better when the shape never
    // varies, and these names are public API once anyone subscribes.
    for (const event of WebhookEventSchema.options) {
      expect(event, event).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });

  it("has no event per open", () => {
    // Deliberate: Apple's Mail Privacy Protection fetches the pixel
    // near delivery, so opens are mostly proxies rather than people.
    // An event stream of them would be noise that reads as signal.
    expect(WebhookEventSchema.options).not.toContain("contact.opened");
  });
});

describe("form.submitted", () => {
  async function liveForm() {
    return repos().form.create({
      name: "Refinance enquiry",
      type: "embedded",
      status: "live",
      createdBy: "mm",
      config: {
        // A form must ask for at least an email or a phone, or nobody
        // can reply to the enquiry and it is rejected.
        fields: ["name", "email"],
        thanks: "Thanks — we'll be in touch.",
        destination: { kind: "register-only" },
      },
    });
  }

  it("announces a lead even when no deal is created", async () => {
    const form = await liveForm();
    await submitForm(form, {
      name: "Sarah Chen",
      email: "Sarah@Example.com",
      phone: "0400 000 000",
      answers: { goal: "Lower my rate" },
    });

    const lead = emitted.find((e) => e.event === "form.submitted");
    expect(lead).toBeDefined();
    expect(lead!.data.email).toBe("sarah@example.com");
    expect(lead!.data.name).toBe("Sarah Chen");
    expect(lead!.data.answers).toEqual({ goal: "Lower my rate" });
    // register-only is a design choice, not a failure, and the payload
    // has to let a receiver tell the difference.
    expect(lead!.data.dealCreated).toBe(false);
    expect(lead!.data.dealError).toBeNull();
  });

  it("does not announce a submission the form rejected", async () => {
    const form = await liveForm();
    await submitForm({ ...form, status: "draft" }, {
      name: "Sarah Chen",
      email: "sarah@example.com",
      phone: "",
      answers: {},
    });
    expect(emitted).toHaveLength(0);
  });
});
