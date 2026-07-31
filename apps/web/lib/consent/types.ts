export type ConsentCategory = "necessary" | "functional" | "analytics" | "marketing";

export type ConsentAction = "accept_all" | "reject_all" | "customize";

export type ConsentChoices = {
  necessary: true;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
};

/** The exact shape stored in the `voltessa-consent` cookie. */
export type ConsentPayload = ConsentChoices & {
  version: number;
  updatedAt: string;
};
